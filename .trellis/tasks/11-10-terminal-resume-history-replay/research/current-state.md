# 现状调研：终端会话恢复的历史回放

> 本文件是 Phase 1 的研证结论，供 Phase 2 的 implement / check 子代理加载。
> 路径均相对仓库根。只读调研，未改代码。

## 1. 终端输出从不落盘

- PTY 输出链路：`src-tauri/src/terminal/services.rs:460 spawn_reader_thread` → `common/terminal/drain.rs:148 SessionDrain::push` → `terminal/pump.rs:64/134` 合流泵（256KB/16ms）→ `terminal/commands.rs:116/126 terminal_drain(_wait)` → `terminal/router.rs:242/268` → `terminal/manager.rs:79/90`（二进制 `tauri::ipc::Response`）→ `features/terminal/api/terminalApi.ts:96/104` → `shared/utils/drainLoop.ts:281 createDrainTransportScheduler` → `TerminalViewBase.tsx:355/360 writeChunk` → `term.write(bytes)`。
- `SessionDrain` 是 `Vec<u8>` 有界内存：`drain.rs:25` 512KB，分离态只留尾 256KB（`:31`），`close_and_remove_drain`（`:283`）丢弃残量。
- `session_cursors` 表（`agent/chat/session_store.rs:268`）无输出列；`common/terminal/types.rs:29 TerminalSession.history` 恒为空。
- `terminalCache.ts:166` 缓存的是 xterm 实例 + DOM `element`，**不是字节**，JS Map 只在本进程存活。
- 结论：**只能从 CLI 原生 transcript 重建历史，不能从 Neeko 自己的数据重建。**

## 2. agent chat 的历史恢复（对照组）

- `features/agent-chat/hooks/useChatRestore.ts:129 restoreConversation` → `getConversationMessages(meta.id)` → `utils/historyConvert.ts:124 convertHistory` → `setMessages` 只读流 → `resumeAgentChat` 静默建续写通道。
- `features/conversation/api/conversationApi.ts:85 getConversationMessages` 逐页组装（`:54 getConversationMessagesPage`）→ `conversation/commands.rs:143` → `conversation/manager.rs:597 get_messages_page` → `:674 load_transcript`。
- 每页 ≤1.5MB 序列化字节 / ≤800 条且至少 1 条（`manager.rs:1080/1083`，`spec/backend/conversation-adapter.md:443`）。`get_messages_page_from_end` 语义是「跳过末尾 N 条」，**不是**「取最近 N 条」。
- `ConversationMessage{role,content,blocks,timestamp,seq}`，`MessageBlock = text|thinking|toolUse|toolResult`（`conversation/types.ts:6/12`）；`convertHistory` 输出 `ChatMessage`，块 kind = text/reasoning/tool。
- transcript 由 `conversation/adapters/registry.rs:17 all_adapters` 扫描 10 种 CLI（pi / claude-code / codex / opencode / omp / gemini / qoder / codebuddy / grok / reasonix），Neeko 不持有正文。
- conversation id 形如 `<agent_id>:<native_session_id>`（`manager.rs:1244`）。

## 3. 终端恢复现状

- `features/live-sessions/utils/sessionTabFactory.ts:23 recreateSessionTab`：活会话 → `attachSessionId` 接同一 PTY；终止态 → `:65 resumeLaunch` → `liveSessionsApi.ts:64 liveSessionResumeCommand` → `live_sessions/commands.rs:157` → `conversation/manager.rs:972 resume_command_for_native` → `shared/utils/agentCommand.ts:51 buildResumeTaskCommand`，生成 `taskCommand`。
- `TerminalViewBase.tsx:275` 把 `taskCommand` 作为 `createSessionVal` 的 `command` 传入；`:288` 的 `agentDelayMs` 自动拉起分支在 `taskCommand` 存在时**跳过**。
- `adopt_live_session`（`live_sessions/commands.rs:130` → `registry.rs:334`）只继承 title / title_source / has_user_input / native_session_id，不涉输出。`TerminalView.tsx:73` 已把 `resumeFromSessionId` 改成一次性消费。
- chat 分支注释明写「历史归 Histor」。

## 4. 硬阻塞（设计必须解决）

### B1 命令 spawn 即执行 —— 时序

- `terminal/commands.rs:19 create_terminal_session(..., command: Option<String>)` → `router.rs:156` → `manager.rs:103 create_session` → `:130 build_task_command`（`platform/shell_launch/unix.rs:16` 的 `sh -c`）→ `:144 pair.slave.spawn_command(cmd)`。**invoke 返回前 CLI 已启动**。
- 前端 `TerminalViewBase.tsx:275 await createSessionVal(...)` 之后才 `:285 onSessionCreated?.(sessionId)`；此时清屏 / alt-screen 序列大概率已进 drain。
- 没有「等前端信号再执行命令」的门闸；`emit(terminalInputEvent(...))` 写的是 PTY stdin，不是 xterm。
- **含义**：想让历史成为 xterm 收到的第一批字节，回放必须发生在 `createSessionVal` **之前**，而不是 `onSessionCreated` 之后。

### B2 native id 不在 wire + conversation 缓存可能未 hydrate

- `live_sessions/view.rs:19-45 SessionView` 与 `shared/types/liveSessions.ts:30` 都**没有** `nativeSessionId`。
- `live_session_resume_command(session_id) -> Option<Vec<String>>` 只回 argv（形如 `["--resume", native]`），前端拼不出 conversation id。
- `manager.rs:138 hydrate_from_disk_index_if_empty` 只在 `commands.rs:115/201`（list / search）调用，**`get_conversation_messages` 不 hydrate**；`manager.rs:711 session_file_path` 缓存未命中即 Err；启动无全量 scan（Histor 面板打开才扫，`useConversationList.ts:147`）。
- **含义**：必须新增后端 command，且它不能依赖 conversation 扫描缓存已就绪。

### B3 没有对外的 `term.write` 通道

- `term.write` 只有 `TerminalViewBase.tsx:360 writeChunk`（接 `:377` drain scheduler）与 `:428` 错误提示两处。
- `terminalCache.ts:261 resolveTerminalEntry` 能拿到 `CacheEntry.term`，但没有公开写端口；`terminalOutputEvent` 无监听方。
- **含义**：回放逻辑落在 `TerminalViewBase` 的 effect 内最省事（它持有 `term` 实例），由 `TerminalView` 通过 prop 注入数据来源。

### B4 alt-screen / 清屏会遮蔽回放

- 全屏 TUI 启动切 `ESC[?1049h`，主屏被切走；`spec/frontend/state-management.md:2322`、`spec/backend/quality-guidelines.md:298`、`terminal/pump.rs:134`（opencode 清屏重绘）均有记录。
- xterm 的 alt-screen 会保存主屏、退出时恢复；但纯 `ESC[2J` 清屏会直接抹掉主屏内容。**目标 CLI（pi / claude-code）实际发哪种，需要一次实测 spike**，不能靠推断。

## 5. 大文本约束

- 红线 4：单次 Command 返回 JSON ≤2MB（`spec/backend/command-guidelines.md:226`），`Vec<u8>` 经 JSON 膨胀约 6×，须二进制流或分页。
- `shared/utils/terminal.ts:8 TERMINAL_SCROLLBACK = 5000`（行数预算）；`common/terminal/drain.rs:25` 512KB 是输出缓冲。
- 现成可用：`conversation-adapter.md:443` 每页 ≤800 条 / ≤1.5MB 的分页；`transfer.md` 的 `convertHistory` 渲染。
- 无现成的 transcript→xterm 截断策略，需要新定一个上限。

## 6. 不可行的路径（已排除）

- **PTY 原始字节落盘回放**：alt-screen、`ESC[2J`、光标寻址、resize 重绘让字节流不是稳定快照，回放多为乱码或只剩末帧；体积无界，与 08-25 内存治理和背压模型冲突（`spec/backend/concurrency-guidelines.md:508,584`）；`docs/research/agent-session-state-tracking.md:5` 已记「PTY 字节流无会话语义」。
- **独立只读历史分栏（B 方案）**：用户已明确选 A（同一块 xterm 的 scrollback）。
