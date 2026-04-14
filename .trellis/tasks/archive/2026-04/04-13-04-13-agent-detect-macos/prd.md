# macOS/Linux GUI 应用 Agent 检测失败修复

## Goal

Neeko 在 macOS（及潜在的 Linux 桌面环境）上，从 Dock/Finder/桌面启动时无法识别已安装的 Agent CLI 工具。需要在应用启动阶段修复进程 PATH，使 Agent 检测逻辑能正常工作。

## Root Cause Analysis

**核心问题**: macOS GUI 应用 PATH 环境变量继承问题

1. macOS 从 Finder/Dock/Spotlight 启动的 GUI 应用，进程 PATH 由 `launchd` 提供，通常只有：
   `/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin`

2. 用户的 Agent 实际安装在多个位置（以 claude 为例）：
   - `/opt/homebrew/bin/claude` (brew 安装，symlink 到 Caskroom)
   - `/Users/vinci/.local/bin/claude`
   - `/Users/vinci/.superset/bin/claude` (wrapper 脚本，内部遍历 PATH 查找真实二进制)
   
   这些路径由 shell profile (`.zshrc`/`.zprofile`) 注入，GUI 进程不会加载

3. `check_command_exists()` 使用 `Command::new("sh").args(["-c", "which <cmd>"])` 检测，
   该 `sh` 进程继承 Tauri GUI 进程的最小 PATH，找不到 Agent

4. 终端 PTY 不受影响，因为 `portable-pty` 启动了完整的 login shell（zsh），自动加载 profile

**验证结果**:

| 环境 | `which claude` | 结果 |
|------|---------------|------|
| 完整 PATH（终端） | `/opt/homebrew/bin/claude` | 成功 |
| 最小 PATH（GUI 模拟） | exit 1 | 失败 |
| `$SHELL -lc 'echo $PATH'` | 通过用户默认 shell 的 login 模式返回完整 PATH | 可用于修复 |

## Decision (ADR-lite)

**Context**: macOS/Linux GUI 应用不继承用户 shell profile 中的 PATH 配置，导致 Agent 检测全部失败。

**Decision**: 方案 A -- 启动时通过 login shell 解析用户完整 PATH 并注入当前进程。

**排除的方案**:
- ~~方案 B: `sh -c` 改 `sh -lc`~~ -- 每次检测都启动 login shell，性能差；且 `sh -l` 只加载 POSIX profile，不加载用户 shell 特定配置
- ~~方案 C: 手动解析 shell profile~~ -- 解析逻辑复杂，各 shell 配置文件不同，维护成本高
- ~~方案 D: 类似 superset wrapper 遍历 PATH~~ -- wrapper 仍依赖 `$PATH` 内容，GUI 进程 PATH 残缺时同样无效

**Consequences**:
- 启动时多执行一次 login shell（< 100ms），换取全局 PATH 修复
- 后续所有 `Command::new()` 调用都受益，无需逐个修改
- Windows 不受影响（`#[cfg(unix)]` 门控）

## Requirements

* Unix 平台（macOS/Linux）启动时解析用户 login shell 的完整 PATH 并注入进程环境
* Windows 保持现有行为不变
* `check_command_exists()` 逻辑本身无需修改
* PATH 解析失败时静默降级，不影响应用启动

## Acceptance Criteria

* [ ] macOS 从 Dock 启动 Neeko 后，已安装的 Agent（claude、opencode、gemini、codex）显示为可用
* [ ] Agent 选择后终端能正常启动对应 Agent
* [ ] Windows 编译和运行不受影响
* [ ] Linux 桌面环境启动时同样能检测到 Agent
* [ ] login shell 解析失败时应用正常启动（降级到原始 PATH）

## Definition of Done

* 实现代码 + 单元测试
* `cargo check` 通过（含 Windows 交叉编译检查）
* 现有测试不受影响

## Out of Scope

* Agent 自动安装功能
* 自定义 PATH 配置 UI
* 非 login shell 配置的 PATH 修复（如 `.bashrc` only 的情况）
* fish shell 的 `-lc` 语法兼容（PATH 用空格分隔，`-lc` 不被支持）

## Technical Approach

### 改动范围

仅 `src-tauri/src/lib.rs` -- 在 `run()` 函数、`setup()` 之前添加 PATH 修复逻辑：

```rust
#[cfg(unix)]
fn resolve_user_path() -> Option<String> {
    // 优先使用用户的默认 shell（可能是 zsh/bash/fish/nushell 等）
    // SHELL 环境变量由系统设置，反映 /etc/passwd 或 dscl 中的配置
    // fallback 到 /bin/sh（POSIX login 模式，覆盖 /etc/profile + ~/.profile）
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    std::process::Command::new(&shell)
        .args(["-lc", "echo $PATH"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
```

**各 shell 对 `-lc` 的兼容性**:

| Shell | `-lc` 支持 | 加载的配置 |
|-------|-----------|-----------|
| zsh | 支持 | `.zshenv` + `.zprofile` + `.zshrc` |
| bash | 支持 | `/etc/profile` + `~/.bash_profile` (或 `~/.profile`) |
| fish | 不支持 `-lc` | 需要 `fish -l -c "echo $PATH"` -- 但 fish PATH 用空格分隔 |
| sh | 支持 | `/etc/profile` + `~/.profile` |

> 注意: 如果用户默认 shell 是 fish，`-lc` 语法不兼容，需要特殊处理。
> 当前 MVP 先覆盖 zsh/bash/sh（macOS 绝大多数用户），fish 作为后续增强。

在 `run()` 中 `tauri::Builder` 之前调用：

```rust
#[cfg(unix)]
if let Some(full_path) = resolve_user_path() {
    std::env::set_var("PATH", &full_path);
}
```

### 冲突分析（已验证无冲突）

| 现有代码位置 | PATH 使用方式 | 是否受影响 |
|-------------|-------------|-----------|
| `agent.rs:check_command_exists()` | `sh -c "which <cmd>"` 继承进程 PATH | 正面影响（修复目标） |
| `terminal.rs` PTY 创建 | `portable-pty` 启动 login shell，自行获取 PATH | 不受影响 |
| `terminal.rs` `.env()` 调用 | 仅设置 TERM/LANG/LC_ALL | 不涉及 PATH |
| `commands/wsl.rs` | Windows WSL 专用 | 不受影响（平台门控） |

### 风险控制

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| login shell 启动慢 | 低 | 仅执行 `echo $PATH`，实测 < 100ms |
| SHELL 环境变量不存在 | 低 | fallback `/bin/sh -lc`，覆盖 POSIX 标准 profile |
| 用户 shell 是 fish | 低 | fish 在 macOS 占比极小，MVP 不处理；降级到原始 PATH |
| shell profile 有阻塞命令 | 中 | `.filter(o.status.success())` + 可考虑加超时 |
| Windows 编译 | 无 | `#[cfg(unix)]` 完全门控 |

## Technical Notes

* 关键文件: `src-tauri/src/agent.rs` (第 5-29 行) - `check_command_exists()`
* 唯一改动文件: `src-tauri/src/lib.rs` - `run()` 函数
* 前端无需改动
* 参考: VS Code / Electron 应用有类似的 `fix-path` 机制处理同一问题
