//! 各 CLI 配置目录的**解析规则**（本机环境事实，不是契约）。
//!
//! # 为什么独立于数据表
//!
//! 「配置目录在哪」取决于宿主环境（`XDG_CONFIG_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR`），
//! 是唯一需要读环境变量的部分；而「支持哪几个 CLI、各自什么形态」是纯静态数据。
//! 两者变化频率与测试方式都不同：前者要覆盖 env 组合（含相对值/空值回落），
//! 后者只需断言表自洽 —— 混在一起会让数据表的读者被迫越过 7 个 env 解析函数。
//!
//! 全部 `#[must_use]` + `Option`：解析不到 = 该 CLI 在本机未初始化（调用方据此跳过）。
//!
//! 配置根（`.claude` / `.codebuddy` / `.qoder` / `.codex`）**不在这里**：它们同时是
//! 「hook 落在哪」与「会话文件落在哪」的锚点，唯一实现在
//! [`crate::common::agent::descriptor`]（见文件尾的 re-export）。

use std::path::{Path, PathBuf};

/// opencode 插件目录：opencode 全平台使用 XDG 风格 `~/.config/opencode`
/// （`$XDG_CONFIG_HOME` 优先），**不是** macOS 的 `~/Library/Application Support`
/// —— 2026-10-12 用户机实测纠错（`~/.config/opencode/plugins/open-island.js` 为证）。
/// `dirs::config_dir()` 在 mac/win 上会给错误位置，故显式按 opencode 约定解析。
#[must_use]
pub fn opencode_plugins_dir() -> Option<PathBuf> {
    // XDG Base Directory Spec §2：这些变量里的路径**必须**是绝对路径，相对值应视为无效并忽略。
    // 只判 `!is_empty()` 时，相对值会让 install 写出 CWD 相对路径而 status 报「未安装」——
    // 意图与事实错位（同一份 `~/.config` 契约在两种调用下指向不同地方）。
    let config_root = match std::env::var_os("XDG_CONFIG_HOME") {
        Some(xdg) if Path::new(&xdg).is_absolute() => PathBuf::from(xdg),
        _ => dirs::home_dir()?.join(".config"),
    };
    Some(config_root.join("opencode").join("plugins"))
}

/// pi 扩展目录（`<pi 配置根>/extensions`，orca 实测验证的安装面）。
///
/// 配置根由 [`crate::common::agent::descriptor`] 拥有：这里**派生**而不是再写一遍
/// `~/.pi/agent`（同一事实两份字面量 = qoder 那类漂移的温床）。
#[must_use]
pub fn pi_extensions_dir() -> Option<PathBuf> {
    crate::common::agent::descriptor::pi_config_root().map(|root| root.join("extensions"))
}

/// OMP 扩展目录（`<omp 配置根>/extensions`）—— 与 pi 同 API 的扩展面，
/// 本机已装 orca 的 `orca-agent-status.ts` 为证（其文件内注释明写
/// 「Pi and OMP expose the same extension API」）。
#[must_use]
pub fn omp_extensions_dir() -> Option<PathBuf> {
    crate::common::agent::descriptor::omp_config_root().map(|root| root.join("extensions"))
}

// ─── 配置根：唯一实现在 `common::agent::descriptor` ──────────────────────────
//
// 这些根同时是「hook 落在哪」与「会话文件落在哪」的锚点，因此不允许本域另写一份：
// qoder 的历史缺陷就是两处各写一遍（`~/.qoder` vs `~/.qodercli`），漂移后静默失效。
pub use crate::common::agent::descriptor::{
    claude_config_root as claude_config_dir, codebuddy_config_root as codebuddy_config_dir,
    codex_config_root as codex_config_dir, qoder_config_root as qoder_config_dir,
};
