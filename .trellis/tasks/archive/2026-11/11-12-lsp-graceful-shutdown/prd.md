# LSP 关闭协议合规：项目停用不再硬杀服务器

## Goal

把「怎么关掉一个语言服务器」收归**唯一一条**协议合规的关闭序列，让「关会话」不再成为
服务器侧状态损坏的源头。直接症状：jdtls 的 Eclipse workspace 快照在进程被强杀的 checkpoint
窗口内损坏，下一次启动在 `SaveManager.restore()` 抛 `ObjectNotFoundException` →
`ResourcesPlugin` / `jdt.core` / `jdt.ls.core` 连锁起不来 → `Application error` 退出，
用户侧看到的是 `jdtls exited unexpectedly | stderr: WARNING: Using incubator modules` 与
`LSP initialization: no response received`，并且**无法自愈**（每次启动都撞同一个坏快照）。

## Background

完整证据链（命令 + 实测输出 + 时间线）见 `research/jdtls-workspace-corruption.md`。要点：

- 出事路径是**项目停用**：`close_sessions_for_project`（`manager.rs:879-906`）把 LSP 的
  `shutdown` 当 **notification** 发（规范要求是 request、必须等响应），随后
  `sleep(10ms)` + `kill_child()`。Eclipse 没有机会 checkpoint，`0.snap` 落在半写状态。
  触发时机为 `schedule_deactivate` 的 30 分钟休眠到期（`DEFAULT_DEACTIVATE_STOP_SECS`）。
- 单会话关闭路径（`close_session_impl`，`manager.rs:861-877`）**发的是 request**，顺序正确，
  但同样在 `exit` 之后**立即** `kill_child()`，不等进程自行退出 —— 依然可能截断 checkpoint。
  两条路径的第二半（发完 `exit` 就杀）是同一个缺陷。
- 现有关闭测试只断言「落终态 + 推 `stopped`」（`manager.rs:1455`/`1477`），
  对**线上握手用什么方法、是否等响应、是否等进程退出**零覆盖 —— 所以协议违规能长期存活。

## Requirements

- **R1（单一关闭序列）**：全仓只有一处实现「关掉一个 LSP 服务器」的协议序列，形态固定为
  `shutdown` **request** → 等响应（有界）→ `exit` **notification** → 等进程自行退出（有界）
  → 超时才 `kill`。`close_session` / `close_session_for_restart` / `close_sessions_for_project`
  三条入口都只调它，不得各自拼装。第二份实现即违规（红线：单一职责 + DRY）。
- **R2（有界，不挂死）**：三步等待全部有界：`shutdown` 响应超时、进程退出宽限超时、
  以及等待期间的兜底 kill。任一步超时都**必须**继续走到下一步并最终收口，不允许
  `blocking_recv` 无界阻塞调用线程（`spawn_blocking` 池不是无界资源）。
- **R3（宽限期是插件数据）**：进程退出宽限时长按服务器声明（`LspServerTuning`），
  jdtls 需要显著大于默认值（Eclipse checkpoint 可达秒级）；通用服务器用默认值。
  禁止出现 `language_id == "java"` 分支（红线 15）。
- **R4（顺序可观测、可断言）**：关闭序列产生的报文与等待必须能被单测观察到 ——
  即「`shutdown` 是 `Message::Request` 而非 `Notification`」「`exit` 在其后才发」
  「响应到达前不 kill」都能在无真实进程的条件下断言。
- **R5（不阻塞异步运行时）**：有界等待仍然只允许发生在 `spawn_blocking` / 专用线程里，
  不得占用 tokio worker（红线 3 的形态）。
- **R6（行为不变的部分）**：终态落账与 `stopped` 事件语义**不变**（`Announce` 发、重启 `Silent`
  不发；reader 退出在已关闭会话上必须静默）。既有测试全绿即满足。
- **R7（范围）**：不改 jdtls 的 `-data` 归属、不改崩溃文案的证据来源、不改前端。
  这两项另行立项（见 Out of scope）。

## Acceptance Criteria

- **AC1**：`close_sessions_for_project` 与 `close_session_impl` 走同一个关闭函数 ——
  `rg -n 'send_notification_raw\("shutdown"' src-tauri/src` 零命中；
  关闭序列函数只有一个定义点。
- **AC2**：新测试断言项目停用路径发出的第一条报文是 `Message::Request`，且 `method == "shutdown"`；
  第二条是 `method == "exit"` 的 notification。用现有 `stub_session` 的 writer 信道观察
  （需要 testing 辅助暴露 receiver，见 design）。
- **AC3**：响应未到达时不 kill：注入一个「收到 shutdown 就 kill 即失败」的假进程，
  时序断言通过；响应到达后才进入 `exit` 阶段。
- **AC4**：进程不退出的坏服务器在宽限期后仍被收口（有界），测试用可控的
  「永不退出」假进程 + 短宽限（不得靠 sleep 真实秒数堆墙钟，见 implement）。
- **AC5**：`LspServerTuning` 新增宽限字段，默认值覆盖测试；java 插件声明值 > 默认值，
  且 `non_java_builtins_keep_generic_tuning` 扩展后仍通过（红线 15 的回归位）。
- **AC6**：`cargo test --manifest-path src-tauri/Cargo.toml --lib` 全绿；
  既有 `close_sessions_for_project_emits_stopped` / `close_session_emits_stopped_and_marks_closed_terminal` /
  `restart_close_is_silent_but_still_terminal` 语义不变。

## Out of scope（已记录，另行立项）

1. **jdtls 的 `-data` 归属**：让 Neeko 显式传 `-data`（按**全路径**哈希、放 Neeko 自己的目录），
   从而①消除「同名工程共用 workspace」的碰撞（brew 启动器只按 basename 哈希），
   ②让 Neeko 能读到 `.metadata/.log`。需要给 `LspPlugin` 增加「按会话求值的 argv 模板」
   输送管道（现状 `server_command: Vec<String>` 是静态的）。
2. **崩溃证据可操作化**：`lifecycle.rs:163` 的 `crash_message` 目前只能投影 stderr 尾部；
   jdtls 的致命日志在文件里。依赖第 1 项才能知道文件在哪。
3. 存量已损坏 workspace 的自愈/检测（本次以手工 `rm -rf <data>` 收口）。

## T1 台账（审计整改拆出的独立任务，2026-11-12）

4 维审计（`research/audit-{lifecycle,channel,orchestration,contracts}.md`，44 条去重后 31 条）
里与关闭协议无直接关系的部分，已拆成独立任务（各自有 prd.md）：

| 任务 | 收的是 |
| --- | --- |
| `11-12-lsp-request-channel-integrity` | error response 误触发重启 + restart streak 不清零；三套 id 共用一个 pending 表；业务请求无界等待；写失败泄漏；握手双终态写者 |
| `11-12-lsp-document-identity` | 重启丢 `open_docs`/`editor_owned`（reopen 恒 0 条）；`didChange` 不更新登记表；第四个 didOpen 出口 + 死 IPC；文档定根不进 key；TS/TSX 双服务器 |
| `11-12-lsp-cross-layer-contracts` | `lsp_request`/`lsp_transport` 无 2MB 预算（红线 4）；诊断清除项目粒度误清他语言；`relatedInformation` 假声明；`$/progress` 载荷形态；事件常量跨栈断言；status union/camelCase；`indexing` 绕过 lifecycle；transport 监听器泄漏 |
| `11-12-lsp-install-lifecycle` | 远端安装产物与判据不同环境；安装跑在装配路径；安装去重键；`remove_project` 不拆 LSP |

本任务（11-12）只收 T0：退出清理串行化、退出预算改总计、per-key 关闭收口、握手 deadline、
前端 extension-map 丢 `requestTimeoutMs`。

其余「记录不修」项（`diag_bus` Drop 用索引删 / 未使用的 `LspDiagnostic` DTO /
`window/showMessage` 静默丢弃 / `language_for_path` 潜伏陷阱 / SSH `kill_tree` 回退只杀 bash）
留在审计报告里，属执行器域或当前不可达。
