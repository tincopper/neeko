# 终端会话恢复回放历史对话

## Goal

从侧栏恢复一条已结束的**终端 agent 会话**时，让用户在**同一个 terminal tab**里看到这条会话之前发生过什么，而不是只得到一个空的新终端。历史对话作为文本灌进同一块 xterm 的 scrollback，新的 `--resume` PTY 输出接着往下写；不改布局、不分栏、不新开页面。

## Background

- 终端输出**从不落盘**：PTY 字节只进 `SessionDrain`（有界内存 512KB，分离态留尾 256KB，`src-tauri/src/common/terminal/drain.rs:25,31,82`），`close_and_remove_drain` 丢弃残量；`session_cursors` 表无输出列（`src-tauri/src/agent/chat/session_store.rs:268`）。进程退出 / 应用重启后字节全丢，`terminalCache.ts:166` 缓存的是 xterm 实例而非字节。
- agent chat 的「历史恢复」不是 Neeko 自存，而是现读 CLI 原生 transcript 渲染成只读消息流：`useChatRestore.ts:129-170` → `getConversationMessages` → `convertHistory` → `setMessages`。`conversation` 域扫描 10 种 CLI transcript（`src-tauri/src/conversation/adapters/registry.rs:17`），Neeko 不持有正文。
- 终端恢复当前只做「起新 PTY + `--resume <native id>`」：`sessionTabFactory.ts:23-70` → `liveSessionResumeCommand` → `buildResumeTaskCommand` → `TerminalViewBase.tsx:288` 作为 `taskCommand` 传入 `createSessionVal`。`adopt_live_session` 只继承标题 / `has_user_input` / native id（`src-tauri/src/live_sessions/registry.rs:334-370`），不涉输出。
- `TerminalViewBase.tsx:506-534` 外层是 `flex-col`，唯一子区是 `terminal-wrapper`（xterm 挂载点）；整页没有可承载独立历史区的 React 容器。
- 侧栏可见性规则见 `src/shared/selectors/liveSessionSelectors.ts`；恢复行由 `src-tauri/src/live_sessions/boot.rs` 回填为 `Stopped`，点它走 `recreateSessionTab`。
- 完整调研（输出链路 / transcript 分页契约 / 四个硬阻塞）见 `research/current-state.md`。

## Requirements

- **R1**：恢复带 `nativeSessionId` 的终端会话时，在 PTY 输出之前把该会话的历史对话以纯文本写进同一个 xterm 的 scrollback。
- **R2**：历史与续写之间有一条可见分隔线；用户可向上滚动回看历史，新 PTY 输出接在分隔线之后继续往下写。
- **R3**：不改变终端页面布局（不分栏、不新增视图、不改 `fitAddon` 尺寸契约），不新开 tab、不跳 Histor 面板。
- **R4**：底层仍是 `--resume` 续写的新 PTY；进程不复活，历史只读、不可编辑、不参与 PTY 输入。
- **R5**：回放的是 transcript 里的**对话消息**（user / assistant / tool），不含 shell 命令输出、TUI 面板帧、ANSI 重绘。
- **R6**：拿不到历史的会话（纯 shell、无 `nativeSessionId`、transcript 未扫到、adapter 不支持）保持现状：直接起新终端，不报错、不留空白历史区。
- **R7（回放范围）**：每次恢复只回放**最近 50 条**对话消息；更早的压成一行「已省略 N 条，完整历史见 Histor」，不回放、不计入载荷。完整历史仍由已有的 Histor 面板提供。
- **R8（回放内容）**：每条消息取纯文本 + tool 调用的一行摘要；**不含** thinking 块与 tool 原始输出，避免回放被大段工具日志淹没。

## Technical Notes

- 方案 A（同一块 xterm 的 scrollback）已与用户确认；B 方案（独立只读历史区 + 分栏）明确不做。
- `terminal/manager.rs:144` spawn 即执行 `taskCommand`，因此回放必须在 `createSessionVal` **之前**完成，否则顺序必然反。
- `SessionView` 无 `nativeSessionId` 字段，且 conversation 索引在只开侧栏时可能未 hydrate，需新增按 `sessionId` 取历史的后端 command。
- 分页契约：`conversation/manager.rs:1080/1083` 每页 ≤800 条 / ≤1.5MB；`get_messages_page_from_end` 语义是「跳过末尾 N 条」，**不是**「取最近 N 条」，实现时勿用反。
- 单次 Command 返回 JSON ≤2MB（红线 4，`spec/backend/command-guidelines.md:226`）；R7 的 50 条上限是产品口径，`REPLAY_CHAR_LIMIT` 是载荷兜底，两者取先到者。
- 全屏 TUI 启动会切 alt-screen，主屏被切走；历史在 TUI 运行期间不可见，退出 TUI / 滚回主屏才回得来。这是 xterm 固有行为，方案 A 接受，不为此引入分栏。若实测发现目标 CLI 会用 `ESC[3J` 清 scrollback，方案 A 不成立，须停下回报用户重新选择（见 `design.md` §8 与 `implement.md` 第 0 步）。
- 现有工作树里有上一轮「侧栏显示时机 + 重复会话去重」的未提交改动，本任务不回滚、不覆盖。

## Acceptance Criteria

- [ ] **AC1**（R1/R2/R3）：从侧栏恢复一条有 transcript 的 pi 终端会话，同一个 tab 内向上滚动能看到历史对话文本，随后是分隔线与新会话输出；DOM 无新增分栏容器，`fitAddon` 调用点不变。
- [ ] **AC2**（R4）：历史区不接受键盘输入、不影响 `--resume` 命令的正常启动与后续交互。
- [ ] **AC3**（R6）：恢复纯 shell / 无 native id / 无 transcript 的会话，行为与改动前一致（空终端，无报错、无空白历史区）。
- [ ] **AC4**（R7 + 红线 4）：长 transcript（>50 条）只回放最近 50 条并显示「已省略 N 条」；单次 IPC 载荷不超 2MB，恢复耗时在合理范围内。
- [ ] **AC5**（R8）：回放包含 user / assistant 纯文本与 tool 一行摘要，不含 thinking 块与 tool 原始输出。
- [ ] **AC6**（全局）：新增/修改的纯函数与关键路径有单元测试；`pnpm check:quick` 通过。
- [ ] **AC7**（R1 时序）：`term.write(回放)` 发生在首个 drain chunk 之前；回放读取失败仍照常创建 PTY。

## Out of Scope

- PTY 原始字节流落盘与回放（alt-screen / 清屏 / 光标寻址使字节流不是稳定快照，体积无界）。
- 恢复 shell 命令输出、TUI 面板画面、滚动位置、光标位置。
- 让已结束的进程复活；底层仍是新 PTY。
- 全量回放整个 transcript（已选 R7 的 50 条口径）。
- B 方案（终端上方独立只读历史区 + 分栏）、chat 会话恢复链路的改动。
