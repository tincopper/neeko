# 修复 agent.rs 跨平台编译错误

## Goal

修复 `src-tauri/src/agent.rs`、`src-tauri/src/commands/wsl.rs`、`src-tauri/src/git/local.rs` 中的跨平台编译错误，使 `cargo check` 在 macOS 上通过。

## 问题总览

当前工作树有 3 个编译阻断问题，都是 stash/merge 冲突未正确解决导致的：

| 文件 | 问题 | 严重级 |
|------|------|--------|
| `agent.rs:7-13` | 残留合并冲突标记（`<<<<<<<`/`=======`/`>>>>>>>`），Rust 语法无效 | P0 |
| `commands/wsl.rs:7-11` | `#[cfg(windows)]` 下 `cmd` 不可变，但 `.creation_flags()` 需要 `&mut Command` | P1 |
| `git/local.rs:9-13` | 同上，`no_window_cmd` 中 `cmd` 不可变导致 Windows 编译失败 | P1 |

**根本原因**：stash 中用 `#[cfg] let cmd = { ... }` 这种"条件编译表达式赋值"写法在 Rust 中不合法。`#[cfg]` 只能修饰**语句/项**，不能修饰 `let` 赋值表达式。

## Requirements

- 解决 `agent.rs` 中的合并冲突标记
- 将 `check_command_exists` 中的 `cfg!()` 运行时分支改为 `#[cfg(...)]` 条件编译属性
- 修复 `commands/wsl.rs` 和 `git/local.rs` 中的 `unused_mut` / 可变性错误
- 确保 Windows 平台的逻辑保持不变（`cmd /c where` + `CREATE_NO_WINDOW`）
- 顺手修复测试代码中的 `cfg!()` 用法

## 修复方案

### 修复 1：agent.rs — 解决合并冲突 + 正确使用条件编译

**当前状态**（第 6-31 行）有合并冲突标记，HEAD 版本用 `cfg!()` 宏做运行时分支，stash 版本用 `#[cfg(...)]` 条件编译属性（正确做法）。

**修复目标**（第 6-31 行）：

```rust
pub fn check_command_exists(command: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        Command::new("cmd")
            .args(["/c", &format!("where {}", command)])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("sh")
            .args(["-c", &format!("which {}", command)])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}
```

- stash 版本是正确方向（`#[cfg]` 条件编译）
- 保留 HEAD 版本中的 `.creation_flags(0x08000000)` 避免 Windows 下弹出 cmd 窗口
- 每个分支内独立完成 `.map().unwrap_or()`，不跨分支共享后半段逻辑

**同时修复测试代码**（agent.rs 末尾 tests 模块）：

```rust
// 改前（cfg! 宏，运行时分支）：
let cmd = if cfg!(target_os = "windows") {
    "cmd"
} else {
    "sh"
};

// 改后（条件编译）：
#[cfg(target_os = "windows")]
let cmd = "cmd";
#[cfg(not(target_os = "windows"))]
let cmd = "sh";
```

### 修复 2：commands/wsl.rs — 恢复可变绑定

**当前代码**（第 5-13 行）：

```rust
fn wsl_command(program: &str) -> std::process::Command {
    let cmd = std::process::Command::new(program);   // 不可变
    #[cfg(windows)]
    let cmd = {                                        // 类型不匹配
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000)                 // 需要 &mut self
    };
    cmd
}
```

`creation_flags()` 需要 `&mut Command`，但外层 `let cmd` 是不可变的。`#[cfg]` 不能修饰 `let` 赋值表达式。

**修复目标**：

```rust
fn wsl_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}
```

`let cmd` → `let mut cmd`，`#[cfg]` 块改为普通块语句（非 `let` 表达式）。

### 修复 3：git/local.rs — 同修复 2

**当前代码**（第 7-15 行）问题相同：`let cmd` 不可变 + `#[cfg]` 修饰 `let` 表达式。

**修复目标**：

```rust
fn no_window_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}
```

完全同修复 2 的模式。

## Acceptance Criteria

- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 在 macOS 上通过（0 error, 0 warning）
- [ ] `pnpm tauri build` 在 macOS 上完整构建成功
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 测试全部通过
- [ ] Windows 条件编译逻辑正确保留

## Technical Notes

- 正确的 Rust 条件编译模式始终是 `let mut cmd = ...; #[cfg(...)] { ... } cmd`
- 对于需要完全不同返回逻辑的情况（如 `check_command_exists`），使用 `#[cfg]` 修饰整个函数体块，每个块独立返回
- 参考项目中已有的平台门控模式（如 `terminal.rs` 中的 WSL 相关代码）
