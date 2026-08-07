# 执行计划：修复 build 后 Cmd+W 失效与 Agent 进程残留

## 阶段 0：基线确认（开始前）
- [ ] 确认 `cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm test:run`、`pnpm type-check` 基线全绿。
- [ ] 确认分支在 main 上、工作区干净。

## 阶段 1：问题 1 诊断（TDD 红/绿前置）

### 1.1 临时诊断日志（不加测试，纯定位）
- `src-tauri/src/app.rs` `on_menu_event`：`log::info!("[CmdW] menu event close_tab fired")`。
- `src/app/hooks/useAppShell.ts:263` close-tab 监听：`console.log('[CmdW] close-tab event received')`。
- `src/shared/hooks/useKeyboardShortcuts.ts:149` closeTab case：`console.log('[CmdW] keydown closeTab matched')`。

### 1.2 用户 build 复测
用户构建 release 后按 Cmd+W，回报日志/控制台输出，按 design.md D1 分支判定：
- keydown 到达 → 方案 A（主线）。
- keydown 未到达 → 方案 C（objc2 NSEvent monitor）。

## 阶段 2：修复问题 1（按 1.2 结果选一路）

### 方案 A：前端 keydown 主路径 + 移除菜单 accelerator
- **Rust** `app.rs`：`Close Tab` 菜单项去掉 `.accelerator("CmdOrCtrl+W")`；`on_menu_event` 删除 `cmd_w_flag` 相关逻辑（保留 emit `close-tab`）；`CloseRequested` 删除 flag 分支（macOS 直接放行红点关闭）。删除 `AtomicBool`/`Arc` import 中不再使用项。
- **前端**：`closeTab` action 已有测试覆盖（macOS Cmd 匹配 `modifiersMatch`），无需改绑定。确认无 tab 时 `activeTabIdRef.current` 为空不动作。
- **TDD**：`app.rs` 无纯逻辑可测（移除项）；补 Rust 侧无。前端沿用既有 `useKeyboardShortcuts.test.ts`（已验证 macOS metaKey 匹配）。

### 方案 C（fallback）：macOS NSEvent local monitor
- 新增 `terminal`/`core` 层或 `app.rs` 内 `#[cfg(target_os = "macos")]` objc2 代码，注册 `NSEvent.addLocalMonitorForEventsMatchingMask(NSEventMaskKeyDown)`，检测 `metaKey && keyCode == 13 (w)`，调 `window.emit("close-tab")`，返回 `nil` 阻止分发。
- 资源释放：应用退出时移除 monitor。
- 此路涉及 objc2 unsafe 代码，需最小化并加注释。

## 阶段 3：修复问题 2 —— 进程树兜底（TDD：红→绿→重构）

### 3.1 红灯：Rust 单元测试
在 `terminal/services.rs` 或新测试模块新增测试：
- `collect_session_processes` 应返回同 sid 或祖先链含 shell 的进程（构造：当前测试进程 fork 子进程，子进程 setsid 脱离组，仍与父进程同祖先链 → 断言被收集）。
- `kill_processes` 对脱离组进程发送信号后进程消失。
- 清理测试进程，避免泄漏。

### 3.2 绿灯：实现
- macOS：新增 `libproc` 依赖（Cargo.toml，`target.'cfg(target_os = "macos")'.dependencies`），`proc_listallpids` + `proc_pidinfo(PROC_PIDTBSDINFO)` 枚举。
- Linux：遍历 `/proc/*/stat` 解析 `pid ppid sid`（参考 `lsp/session/utils.rs:28`）。
- `graceful_kill`（Unix 分支）进程组 kill 后调用 reaper；Windows 保持 Job Object 路径。

### 3.3 重构
- 平台枚举函数抽到独立 `terminal/process_reaper.rs`（高内聚），`services.rs` 仅调用。
- 遵循 mod.rs 极薄、if-let 不超过 3 层、cfg 门控等红线。

## 阶段 4：回归验证
- [ ] `pnpm type-check`、`pnpm lint`、`pnpm test:run`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`、`cargo clippy`
- [ ] 用户 build 复测：Cmd+W 关 tab、红点关窗、Agent tab 关闭后 `ps` 无残留
- [ ] WSL/SSH 会话关闭回归抽查
- [ ] 移除 1.1 的临时诊断日志

## 阶段 5：收尾
- [ ] 同步 `.trellis/spec/backend/window-lifecycle.md`（记录 build 差异根因与最终方案，若方案 A/C 改变既有约束）
- [ ] 运行 `add_session.py` 记录会话
- [ ] 不主动 commit
