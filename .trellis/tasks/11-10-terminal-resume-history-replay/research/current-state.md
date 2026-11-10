# 现状调研：纯 shell 终端输出回放

> Phase 1 调研结论（**第二版**：需求已从「回放 agent CLI transcript」更正为「回放纯 shell 终端的命令与输出」）。
> 供 Phase 2 的 implement / check 子代理加载。路径均相对仓库根。只读调研，未改代码。

## 0. 范围更正

**只针对纯 shell 终端**：tab 上 `agentId = null`、不绑 agent CLI 的 PTY。agent TUI 终端（pi / claude-code / opencode …）**不在范围内**，不回放，也不为其落盘输出。

前一版按「读 `conversation` 域的 CLI transcript 渲染对话消息」做的规划（以及针对 agent CLI 首帧清屏序列的 A0 spike）已全部作废，产物已删除。

## 1. 输出链路与落盘点

- 链路：`src-tauri/src/terminal/services.rs:460 spawn_reader_thread` → `common/terminal/drain.rs:148 SessionDrain::push` → `terminal/pump.rs:64/134` → `terminal/commands.rs:116/126 terminal_drain(_wait)` → `terminal/router.rs:242/268` → `terminal/manager.rs:79/90`（二进制 `tauri::ipc::Response`）→ `features/terminal/api/terminalApi.ts:96/104` → `shared/utils/drainLoop.ts:281` → `TerminalViewBase.tsx:355/360 writeChunk` → `term.write`。
- `spawn_reader_thread`（`services.rs:427`，`thread::Builder::spawn` 于 `:445`）是**专用 OS 阻塞线程**，不是 tokio task；读循环由 `pump::run_polling` / `run` 阻塞 8KB read 驱动。
- `flush`（`:457`）目前只有两个消费者：`activity.observe`（`:459` → `live_sessions/wiring/pty.rs:194` → OSC 7501 状态扫描）与 `SessionDrain::push`（`:460`）。**没有旁路 sink、没有落盘、没有 ANSI 解析**。
- 在这条线程上同步写盘不违反红线 3（该红线禁的是 async Command 里直接阻塞；`concurrency-guidelines.md:691` 明示 PTY 用 `std::thread`），但**同步写会拖慢读泵**。故走 mpsc → 独立写线程批量落盘。批量写先例：`conversation/disk_index.rs:72 save_index`（tmp + rename）、`agent/hooks/ingest/dispatch.rs:63 AppRuntime::spawn_blocking`。
- `SessionDrain` 有界：`drain.rs:25` 512KB；分离态只留尾 256KB（`:31`，`push_dropping_head:72`）。

## 2. ANSI 净化

- `conversation/text.rs:31 strip_ansi` 只覆盖 `\x1B\[[0-9;]*[a-zA-Z]`（纯 CSI），**不覆盖** `?1049h` / OSC / charset / `\r` / alt-screen；且它是 `pub(crate)` 内部实现（`conversation/mod.rs:16`），`quality-guidelines.md:1060` 禁跨域直引 ⇒ `terminal` 域**不能依赖** `conversation::text`。
- 前端 `src/shared/utils/stripAnsi.ts:29` 覆盖 CSI / OSC / charset，`features/terminal/utils/inputTitle.ts:145 escapeSequenceLength` 有跨块解析经验，可作判据参照。
- `src-tauri/Cargo.toml` 无 `vte`，只有 `regex`（`:51`）。
- **结论**：净化器落在 `common/terminal/recorder.rs`，自己实现 CSI / OSC / charset / alt-screen 的剥离与 `\r` → `\r\n`，不引跨域依赖。

## 3. 存储形态与位置

- `agent_sessions.db` 的私有迁移链 `agent/chat/session_store.rs:266 run_migrations`： `CREATE TABLE IF NOT EXISTS` + `add_missing_columns`（`:292`，按 `PRAGMA table_info(session_cursors)` 补列）。**能加新表**，但本库无第二张业务表的先例；`common/db/mod.rs:18` 已开 `foreign_keys`，新表可用 `REFERENCES session_cursors(session_id) ON DELETE CASCADE` 自动回收。
- 文件方案更简：输出日志无 schema 版本门禁，按 `common/paths.rs:32 app_dir()` 的语义属「非版本化状态」；但 `NEEKO_DB_DIR` 只覆写 `db_dir()`（`:44`），若放 `app_dir()` 则不随库目录隔离。为与会话数据同生命周期、同隔离单位，**建议放 `db_dir()/terminal_history/<session_id>.log`**。
- 先例：`conversation/disk_index.rs:47` 在 `app_dir()` 下写索引文件。
- 回收 / 迁移点（每个都要处理，否则孤儿或丢历史）：
  | 事件 | 位置 | 动作 |
  | --- | --- | --- |
  | `adopt(from, into)` | `live_sessions/registry.rs:334`（`write_entry:369`、`delete_cursor:370`） | 日志 from → into 改名 / UPDATE |
  | `unregister` | `registry.rs:459` → `session_store.rs:442 delete_cursor` | 删日志 |
  | `restore_from_store` | `registry.rs:489` | 不产出新日志；启动时清理不在 cursor 表里的孤儿文件 |
  | 用户删除行 | `app/session_lifecycle.rs:47 delete_live_session` | 随 `delete_cursor` 删日志 |

## 4. id 关联与 adopt 陷阱

- `ResumeCursor`（`session_store.rs:75`）有 `cwd` / `project_id` / `worktree_path` / `started_at`；纯 shell 的 `agent_id = ""`、`native_session_id = None`，且仅在 `has_user_input` 时落行（`live_sessions/cursor.rs:80`）。
- `live_sessions/view.rs:19 SessionView` **无 `cwd`**；`sessionTabFactory.ts:23 recreateSessionTab(session, workspace)` 手上只有 `sessionId` / `kind` / `agentId` / `workspaceKey` / `startedAt` 等 ⇒ 回放只能按 **`resumeFromSessionId`** 让后端查日志。
- `TerminalView.tsx:67-73` 在 PTY 建好之后才 `adoptLiveSession(resumeFrom, newId)` 并一次性消费标记；**回放读取必须早于 adopt**，否则旧 id 的日志已被迁走。
- `adopt` 会把 from 行删掉、into 继承 title / has_user_input / native id。日志若不随之改名，二次恢复就会丢历史。

## 5. 回放通道（关键：不需要新 command）

- `terminal/commands.rs:19 create_terminal_session(..., command: Option<String>)` → `router.rs:156` → `manager.rs:103 create_session` → `:144 spawn_command`：**invoke 返回前 CLI 已启动**，前端 `onSessionCreated`（`TerminalViewBase.tsx:285`）太晚。
- 最小路径：给 `create_terminal_session` 增 `resume_from: Option<String>`；`manager.rs` 在 `spawn_pty_pipeline` **之前**读日志、把净化后的字节 `push` 进**新会话的 drain**。reader 的后续输出排在它后面，**顺序天然保证**；复用现成的 `terminal_drain` 二进制通道，`term.write` 拿到的是第一批数据。
- `terminalApi.ts:96 drainTerminal(sessionId): Promise<ArrayBuffer>` 走 `tauri::ipc::Response`（`router.rs:248`）：红线 4 限制的是 JSON（6× 膨胀），二进制不受该约束 ⇒ **无需分页、无需新 command**。
- 但 `TerminalViewBase.tsx:355 writeChunk` 单次巨 write 会撞 12s stall 自愈（`:41`），故回放载荷截到 **256KB**（与 `drain.rs:31` 的分离态尾容量一致）。
- 旧 id 无 drain，直接 `terminal_drain(oldId)` 会 `NotFound`（`router.rs:242` 按 `owner_of` 查）——这正是必须把字节推进新 drain 的原因。

## 6. 体积上限

- `shared/utils/terminal.ts:8 TERMINAL_SCROLLBACK = 5000` 是 xterm 的**行数**预算，不是字节。
- 现成工具：`conversation/text.rs:44 truncate`（按字符）、`conversation/manager.rs:1375 stderr_tail`（按字符边界取尾）、`lsp/session/log_ring_buffer.rs:50 push`（10MB 环）。无按行截断工具。
- 一屏 = `term.rows`（`fitAddon`，`TerminalViewBase.tsx:250/:275`，约 24–60 行）。
- **建议**：每会话日志按 `min(256KB, 5000 行)` 取尾；写入侧滚动截断，避免无界增长。

## 7. 纯 shell 的清屏行为

- `services.rs:576 build_local_shell_cmd` / `:612 default_shell_cmd` 只 `CommandBuilder::new(shell)`（无 `-i`、无 `clear`）；`manager.rs:130` 仅设 TERM / COLORTERM / `NEEKO_SESSION_ID`，**不调用 `term.reset()` / clear**。
- 仓库记录：`packages/dsh-neeko/src/tui/screen.ts:13` 说 alt-screen = `?1049h + 2J + H`（TUI，不在范围）；`:48` 记「实测零 2J/3J」；`pump.rs:134` 记 opencode 清屏重绘。
- **纯 shell 的 prompt 不发 `2J` / `3J`**（用户 shell rc 自定义除外）。回放内容是**净化后的纯文本**（不含 ESC），新 shell 首帧只会追加，不会抹掉 scrollback。若回放原始字节则可能被清屏序列清空 —— 这是坚持「净化后落盘」的第二个理由（第一个是体积）。

## 8. 四个硬阻塞（设计必须解决）

1. **回放字节必须进 drain 且早于 reader 与 adopt**：靠 `create_terminal_session` 的 `resume_from` + `spawn_pty_pipeline` 前 push 解决。
2. **净化器不可跨域引 `conversation::text`**：自建 `common/terminal/recorder.rs`。
3. **adopt / unregister / 删除 / 启动恢复的生命周期迁移**：日志随 cursor 行改名或删除，启动清孤儿。
4. **单次大 write 的 xterm stall**：256KB 上限 + 净化后纯文本。


## 10. 净化器语义更正：单行编辑器（2026-11-10 实测回归）

用户实测反馈：恢复出来的终端是「乱的」—— 孤立 `%`、成片空白行、重复 prompt、`ttop` 半截命令。
落盘日志原文印证了根因（旧 `~/.neeko/terminal_history/*.log`）：

```
%<79 空格>\r\n \r\n\r\ntomgs@tomgs-2 neeko % \r\n\r\n
tomgs@tomgs-2 neeko % \r\n\r\n%<空格>\r\n ...
```

这是 zsh 的 **`PROMPT_SP`**：先输出「反显 `%` + 补白到行尾 + `\r` 归位 + `ESC[J` 清到屏尾」，
再写真正的 prompt。旧净化器把单独 `\r` 一律转成 `\r\n`，又只剥 ESC 而不执行擦除语义，
于是把**本该被覆盖/擦掉的文本**全留了下来，并把一次归位变成多次换行。

真实 PTY 捕获（`/bin/zsh -i -f`，572 字节）还暴露出 `\x08` 退格回显、`\r\r\n` 提交、
`?2004h/l` bracketed paste。修复后的净化器是**单行编辑器**：

| 输入 | 动作 |
| --- | --- |
| `\r` | 光标回行首，**不换行**；后续字符覆盖 |
| `\n` | 提交当前行（去尾部补白）+ CRLF |
| `ESC[K` / `ESC[J` | 擦到行尾；参数 1 = 擦到光标，2 = 清整行 |
| `ESC[G/C/D/P/@/X/H/f` | 设列 / 前后移 / 删字符 / 插空格 / 擦字符 / 设光标 |
| `\x08` / TAB / 其它 C0 | 退一列 / 展开到 8 列边界 / 忽略 |
| SGR / 私有模式 / OSC / DCS / charset | 忽略 |

没有 LF 的超长输出也按 `MAX_LOG_BYTES` 在内存里收敛，防当前行无限增长。

**旧日志兼容**：日志文件头改为 `NEEKO-SHELL-LOG-v2\n`，`read_tail` 读到无头文件直接降级为空
（不回放垃圾）；头不参与 `tail` 截断。用户磁盘上旧格式的两个 `.log` 会在下次会话写入时被覆盖。

**钉子用例**：`recorder::tests::zsh_prompt_sp_redraw_leaves_one_clean_prompt`、
`repeated_prompt_redraws_do_not_duplicate_lines`、`cursor_erase_removes_half_typed_command`、
`legacy_log_without_magic_is_ignored`，以及用真实 572 字节固化的
`real_zsh_session_replays_as_clean_commands_and_output`（断言回放恰好是 5 行命令/输出、零空白行）。

## 9. 不可行 / 不做

- 回放原始 PTY 字节（alt-screen / 清屏 / 光标寻址使其不是稳定快照，体积无界）。
- agent TUI 终端输出落盘：实测 pi 启动 4 秒就 293KB，几乎全是全屏重绘帧，存下来回放只剩末帧。
- 让已结束的进程复活；底层仍是新 PTY。
- 独立只读历史分栏 / 新视图 / 新 tab。
- 读取 agent CLI transcript（前一版方案，已作废）。
