# 纯 shell 终端恢复回放命令输出

## Goal

从侧栏恢复一条已结束的**纯 shell 终端会话**时，在同一个 terminal tab 里先回放这条终端之前执行过的命令与输出（纯文本），再接新 shell 的输出，让用户不必面对一个空终端。不改布局、不分栏、不新开页面。

## Background

- 终端输出**从不落盘**：PTY 字节只进 `SessionDrain`（有界内存 512KB，分离态留尾 256KB，`src-tauri/src/common/terminal/drain.rs:25,31,72`）；`session_cursors` 表无输出列（`src-tauri/src/agent/chat/session_store.rs:268`）；`terminalCache.ts:166` 缓存的是 xterm 实例而非字节。进程退出 / 应用重启后字节全丢。
- 落盘点已定位：`src-tauri/src/terminal/services.rs:457 flush` 是 reader 线程上唯一的字节汇合处，目前只有 `activity.observe` 与 `SessionDrain::push` 两个消费者，无旁路 sink。
- `create_terminal_session`（`src-tauri/src/terminal/commands.rs:19`）经 `manager.rs:144 spawn_command`，**invoke 返回前 shell 已启动**；前端 `onSessionCreated`（`TerminalViewBase.tsx:285`）太晚，回放不能挂在它之后。
- 回放可复用 `terminal_drain` 的二进制通道（`terminalApi.ts:96` → `tauri::ipc::Response`）：后端在 `spawn_pty_pipeline` 前把历史字节推进新 drain，顺序天然保证、零新 command、绕开 spawn 时序。
- 纯 shell 恢复走 `sessionTabFactory.ts:23 recreateSessionTab`（`resumeLaunch` 因无 agent 返回 `{}`），tab 带 `resumeFromSessionId`；`TerminalView.tsx:67-73` 在 PTY 建好后 `adoptLiveSession(resumeFrom, newId)` 并一次性消费该标记。`Registry::adopt`（`registry.rs:334`）会删掉 from 行、让 into 继承身份 —— 日志必须随之迁移，否则二次恢复丢历史。
- `SessionView`（`live_sessions/view.rs:19`）无 `cwd`、无 `nativeSessionId`；纯 shell 的 `native_session_id` 恒为 `None`。回放只能按 `resumeFromSessionId` 由后端查日志。
- 完整调研见 `research/current-state.md`。

## Requirements

- **R1（范围）**：只对 `agentId = null` 的纯 shell 终端会话落盘与回放；agent TUI 终端不落盘、不回放、行为不变。
- **R2（落盘）**：reader 线程把输出经旁路写盘；内容为**净化后的纯文本**（剥离 CSI / OSC / charset / alt-screen，`\r` → `\r\n`），不含 ANSI 控制序列。
- **R3（上限）**：每会话日志按 `min(256KB, 5000 行)` 取尾，滚动截断；不得无界增长，不得拖慢读泵（mpsc + 独立写线程）。
- **R4（回放）**：恢复时在 `create_terminal_session` 阶段由后端读日志、把字节推进新会话的 drain，成为 xterm 收到的第一批数据；随后是分隔线，再是新 shell 输出。
- **R5（顺序与时序）**：回放字节早于 reader 首帧与 `adopt`；不新增 Tauri command、不改前端 `term.write` 时序、不改 `fitAddon` 调用点。
- **R6（布局）**：不改变终端页面布局（不分栏、不新增视图），不新开 tab、不跳 Histor 面板。
- **R7（生命周期）**：`adopt` 时日志 from → into 迁移；`unregister` / 用户删除行时删除日志；启动恢复时清理不在 cursor 表里的孤儿日志。
- **R8（降级）**：无日志 / 读失败 / 非纯 shell / 非恢复路径，一律照常新建终端，不报错、不留空白区。
- **R9（进程）**：底层仍是新 PTY，进程不复活；回放只读、不可编辑、不参与 PTY 输入。

## Technical Notes

- **数据源是 Neeko 自己落盘的输出，不是 CLI transcript**。前一版「读 `conversation` 域 transcript 渲染对话消息」的方案已作废（含其 A0 spike 产物）。
- 净化器落 `common/terminal/history/sanitizer.rs`，**不得**跨域引 `conversation/text.rs:31 strip_ansi`（`pub(crate)` 内部实现，且只覆盖纯 CSI，不覆盖 `?1049h` / OSC / `\r`）。
- 存储建议 `db_dir()/terminal_history/<session_id>.log`：`NEEKO_DB_DIR` 只覆 `db_dir()`（`common/paths.rs:44`），与会话数据同隔离单位；也可选 `agent_sessions.db` 新表 + `ON DELETE CASCADE`（`common/db/mod.rs:18` 已开 foreign_keys）。二选一在 `design.md` 定稿。
- 红线 4 限的是 JSON（6× 膨胀），二进制 `Response` 不受该约束 ⇒ 256KB 回放无需分页；但 `TerminalViewBase.tsx:355 writeChunk` 单次巨 write 会撞 12s stall（`:41`），故上限取 256KB 而非 512KB。
- 纯 shell 的 `build_local_shell_cmd`（`services.rs:576`）/ `default_shell_cmd`（`:612`）不调用 clear / `term.reset()`，prompt 不发 `ESC[2J` / `3J`（用户 rc 自定义除外）；净化后的纯文本回放不会被新 shell 首帧抹掉。
- 工作树里已有「侧栏显示时机 + 重复会话去重」的提交（`2332f726`）与本任务规划产物提交（`a6038130`）；本任务不回滚它们。

## Acceptance Criteria

- [ ] **AC1**（R1/R2/R3）：纯 shell 终端跑过若干命令后，磁盘上存在净化后的纯文本日志；agent TUI 终端不产生日志；单会话日志不超过 256KB / 5000 行。
- [ ] **AC2**（R4/R5/R6）：从侧栏恢复该会话，同一个 tab 内先看到历史命令与输出、随后分隔线与新 shell 输出；`term.write` 调用点未增加，DOM 无新增分栏容器，`fitAddon` 调用点不变。
- [ ] **AC3**（R5 时序）：回放字节在 reader 首帧之前到达 drain；回放读取失败仍照常创建 PTY。
- [ ] **AC4**（R7）：恢复一次后再恢复，历史仍在（`adopt` 迁移生效）；删除会话行后日志被删；构造孤儿日志后重启，孤儿被清理。
- [ ] **AC5**（R8）：无日志 / 非纯 shell / 非恢复路径行为与改动前一致（空终端，无报错）。
- [ ] **AC6**（全局）：新增/修改的纯函数与关键路径有单元测试；`pnpm check:quick` 通过；`cargo test --lib terminal::` 与 `live_sessions::` 通过。
- [ ] **AC7**（R3 性能）：读泵吞吐不被落盘明显拖慢（写盘在独立线程，批量）。

## Out of Scope

- agent TUI 终端（pi / claude-code / opencode 等）的输出落盘与回放。
- 读取 agent CLI transcript / conversation 域（前一版方案，已作废）。
- 回放原始 PTY 字节、恢复 TUI 画面、颜色、滚动位置、光标位置。
- 让已结束的进程复活；底层仍是新 PTY。
- 独立只读历史分栏 / 新视图 / 新 tab。
