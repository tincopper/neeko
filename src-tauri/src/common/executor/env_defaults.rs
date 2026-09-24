//! 命令级**默认环境**：数据表 + 唯一应用点（与领域无关，避免通用执行层反向依赖领域模块）。
//!
//! ## 为什么是"数据表 + 通用函数"，而不是在 facade 里写 `if cmd == "git"`
//!
//! 第一性：默认环境是「命令名 → 环境变量」的**数据**，不是控制流。写成数据表后：
//! - 通用执行层（`core::exec`）与领域层（`common::git`）都只依赖本模块 ⇒ **不产生
//!   `core ↔ git` 双向依赖**（曾出现：facade 直接 `use common::git::…`，而 transport 又
//!   `use core::exec::run`，形成环）；
//! - 新增默认值只需加一行表项，不需要改任何通用逻辑（开闭原则）。
//!
//! ## 当前表项：git 只读语义 `GIT_OPTIONAL_LOCKS=0`
//!
//! 实测依据（本机，2026-09-24）：
//!
//! | 实验 | 结果 |
//! |---|---|
//! | `git status --porcelain` | `.git/index` mtime **变化** ⇒ 读路径有**写副作用**（refresh index），需 optional lock |
//! | `GIT_OPTIONAL_LOCKS=0 git status` | mtime **不变** ⇒ 副作用被消除 |
//! | `git ls-files --others`（含 `core.untrackedCache=true`） | 均不变 ⇒ 非争用源 |
//! | `GIT_OPTIONAL_LOCKS=0 git add && git commit` | **成功** ⇒ **optional lock ≠ 必需锁**，写路径不受影响 |
//!
//! 该副作用会与 IDE / 用户手工 git 争 `.git/index.lock`（现场：两次 `git commit` 因
//! `Unable to create '.git/index.lock': File exists` 失败）。注入点有两处，共同覆盖全部 git 调用：
//! 1. [`crate::core::exec`]（本地执行 facade；`status_worker` / `collapsed_probe` 走的同步桥）；
//! 2. [`crate::common::git::transport`]（Local/WSL/SSH 三端；WSL/SSH 会把 env 渲染成远端 shell 前缀）。
//!
//! **明确否决**进程级 `std::env::set_var`：会被 Tauri 拉起的终端 / agent 子进程继承，
//! 等于改变用户可见环境（用户自己敲的 `git status` 也不再刷新 index）。

/// 命令名 → 默认环境变量表（key 必须与 `SpawnOptions::cmd` 完全一致）。
const DEFAULT_ENV_BY_CMD: &[(&str, &[(&str, &str)])] = &[("git", &[("GIT_OPTIONAL_LOCKS", "0")])];

/// 合并命令的默认环境：调用方**显式**提供了同名变量时尊重调用方。
///
/// 返回新 `Vec` 供调用方在构造 `SpawnOptions` 时借用（`SpawnOptions.env` 是借用切片）。
#[must_use]
pub(crate) fn with_default_env<'a>(
    cmd: &str,
    env: &[(&'a str, &'a str)],
) -> Vec<(&'a str, &'a str)> {
    let defaults = DEFAULT_ENV_BY_CMD
        .iter()
        .find(|(name, _)| *name == cmd)
        .map(|(_, vars)| *vars)
        .unwrap_or(&[]);
    if defaults.is_empty() {
        return env.to_vec();
    }

    let mut merged: Vec<(&'a str, &'a str)> = env.to_vec();
    for (key, value) in defaults {
        if !merged.iter().any(|(existing, _)| existing == key) {
            merged.push((key, value));
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_gets_optional_locks_disabled() {
        let merged = with_default_env("git", &[("GIT_TERMINAL_PROMPT", "0")]);
        assert_eq!(
            merged,
            vec![("GIT_TERMINAL_PROMPT", "0"), ("GIT_OPTIONAL_LOCKS", "0")]
        );
    }

    #[test]
    fn caller_override_wins_and_is_not_duplicated() {
        let merged = with_default_env("git", &[("GIT_OPTIONAL_LOCKS", "1")]);
        assert_eq!(
            merged,
            vec![("GIT_OPTIONAL_LOCKS", "1")],
            "调用方显式值优先"
        );
    }

    #[test]
    fn other_commands_are_untouched() {
        let env = [("FOO", "bar")];
        assert_eq!(with_default_env("ls", &env), env.to_vec());
        assert!(with_default_env("ls", &[]).is_empty());
    }
}
