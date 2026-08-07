# 技术设计：修复 build 后 Cmd+W 失效与 Agent 进程残留

## 现状梳理

### 问题 1：Cmd+W 关闭 tab（build 失效，dev 正常）

当前链路（`src-tauri/src/app.rs`）：

```
Cmd+W → 菜单 "Close Tab"(CmdOrCtrl+W)  [app.rs:217-219]
      → on_menu_event  [app.rs:225-232]
          cmd_w_flag = true
          emit("close-tab") → 前端 useAppShell.ts:263 → handleCloseTab → 关 tab
      → CloseRequested  [app.rs:233-248]（macOS 双重触发）
          if cmd_w_flag.swap(false) { prevent_close() }
```

build 下"完全无反应"（tab 未关、窗口未关）说明：菜单 accelerator consume 了 Cmd+W（前端 keydown 兜底 `useKeyboardShortcuts.ts:149` 收不到），但关 tab 链路未生效。可能子因（需诊断定位）：
- **(a)** build 下 `on_menu_event` 未触发 → flag 未置 → CloseRequested 未 prevent → 但窗口也未关（矛盾，需验证系统 Window 菜单是否接管）。
- **(b)** `on_menu_event` 触发、flag=true → CloseRequested prevent_close 拦住窗口关闭；但 `emit("close-tab")` 事件在 build 下未到达前端 → tab 未关 → "完全无反应"。

### 问题 2：Agent 进程残留

关闭链路（Local）：

```
X 关 tab → closeEditorTab → cleanupTerminalsForTab → closeTerminalSession
        → invoke close_terminal_session → app_state.rs:333 close_session
        → terminal_manager.close_session_in_background → pty-close-* 线程
        → close_pty_handle [services.rs:311] → graceful_kill [services.rs:432]
        → kill(-pgid, SIGTERM) → 2s → kill(-pgid, SIGKILL)
```

`portable-pty` 的 shell 是 setsid 会话/进程组 leader（PGID==PID），`kill(-pgid)` 覆盖整个组。**残留 = 进程已脱离该进程组**（如 Agent CLI 内部 daemonize/setsid 派生子进程），日志"Process group X killed after SIGKILL"后进程仍存在即证。

## 设计决策

### D1：问题 1 —— 诊断驱动，优先"移除菜单 accelerator + 前端 keydown 主路径"

规范 `window-lifecycle.md` 已声明 AtomicBool 来源标记不可靠、且移除菜单项可能被系统 Window 菜单接管（坑 1）。因此：

**Step 1（诊断，必须先做）**：加临时日志定位 build 下断点：
- `app.rs` `on_menu_event` 打日志（是否触发、flag 置位）。
- `useAppShell.ts:263` `close-tab` 监听打日志（事件是否到达）。
- `useKeyboardShortcuts.ts` closeTab case 打日志（keydown 是否到达）。

build 复测后按结果分支：
- **若 keydown 到达且能关 tab**（菜单 consume 主因）→ **方案 A**：移除菜单 `Close Tab` 的 accelerator，前端 keydown 成为唯一 Cmd+W 路径。同时按规范**保留菜单项**（避免坑 1，保留 File > Close Tab 点击能力），`on_menu_event` 保留 emit `close-tab` 但**删除 flag 逻辑**（菜单点击不触发 CloseRequested，flag 无意义且会引入"点菜单后红点关窗被误拦"的新 bug）；`CloseRequested` 的 flag 分支一并移除。
- **若 keydown 未到达**（事件在原生层被吞）→ **方案 C（fallback）**：macOS 用 `objc2` 注册 `NSEvent` local monitor 捕获 Cmd+W，调用 emit `close-tab` 并阻止事件继续分发。项目已有 `objc2 = "0.6"` 依赖。

方案 A 是首选（KISS、可测试、跨平台一致），方案 C 作为 build 下事件无法到达 webview 时的可靠兜底。

### D2：问题 2 —— `graceful_kill` 增加进程树兜底（Unix）

在 `close_pty_handle` 的 Unix 分支，进程组 SIGTERM/SIGKILL 之后，追加**进程树枚举兜底**：

1. 枚举系统所有进程，获取 `(pid, ppid, sid)`。
   - **macOS**：`libproc` —— `proc_listallpids` + `proc_pidinfo(PROC_PIDTBSDINFO)`（新增依赖 `libproc` crate 或直接 FFI）。
   - **Linux**：遍历 `/proc/*/stat`（参考 `lsp/session/utils.rs:28` 既有模式）。
   - **Windows**：已有 Job Object，跳过。
2. 判定"属于该会话"：`sid == shell_pid` **或** 祖先链（递归 ppid）含 shell_pid。
3. 对命中的存活进程（排除 shell 自身，因已处理）按序 SIGTERM → 复用 `GRACEFUL_TIMEOUT_SECS`（2s）→ SIGKILL。
4. 全程在 `pty-close-*` 独立线程执行（满足阻塞 I/O 隔离红线），不接触 async 运行时。

新增私有函数（`terminal/services.rs`，进程管理职责内聚）：
- `fn collect_session_processes(shell_pid: i32) -> Vec<i32>`（平台枚举 + 判定）
- `fn kill_processes(ids: &[i32])`（SIGTERM → 超时 → SIGKILL）

日志：`[PTY] Process tree reaper: N orphaned process(es) for session {id}`。

### D3：不触碰的范围
- 前端 `close-tab` 监听永不调用 `destroy()`（保持规范）。
- `WindowControls.tsx` 的 `.destroy()` 路径不动。
- WSL/SSH（`remote_terminal_manager.close_session`）路径不动，仅回归。
- `cleanupTerminalsForTab` 前端 cache 清理逻辑本次不动（日志已证 `close_terminal_session` 被调用）。

## 风险与缓解
| 风险 | 缓解 |
| --- | --- |
| 移除 accelerator 后系统 Window 菜单接管 Cmd+W（规范坑 1） | 保留菜单项；诊断步骤先确认事件去向；若被接管 → 方案 C |
| 进程树枚举误杀 | 严格限定 sid==shell_pid 或 ppid 祖先链；排除 Neeko 自身 pid；按会话边界 kill |
| libproc 新增依赖 | 仅 macOS；`cfg(target_os = "macos")` 门控，Linux 走 procfs，Windows 不编译 |
| build 差异无法本地复现 | 诊断日志 + 用户 build 复测闭环 |
