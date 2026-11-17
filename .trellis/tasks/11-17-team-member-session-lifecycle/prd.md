# 团队成员会话的侧栏生命周期修复（重启幽灵行 + 侧栏误删）

## Goal

团队成员（队长 / 成员）的 PTY 会话今天和用户自己的会话走**同一条**侧栏生命周期，但只有用户会话应该走。
本任务修两条正确性缺陷，不加任何 UI：

1. **重启幽灵行**：成员会话被写进 `session_cursors`，重启后以「用户手机会话」的身份回到侧栏，
   点下去续写的是**没有团队 MCP 端点 / 凭证 / 隔离配置目录**的裸 CLI。
2. **侧栏误删**：侧栏行尾「删除」能直接结束队长 / 成员的进程，团队域完全不知情。

## 现状（可指到文件的事实）

| # | 事实 | 位置 |
| --- | --- | --- |
| 1 | 成员 PTY 与用户会话共用同一张 live_sessions 注册表；归属（`SessionAttribution::TeamMember { team_id, member_id }`）在**起进程那一刻**写入 | `src-tauri/src/app/team_executor.rs:234-247` |
| 2 | 持久化投影 `ResumeCursor::from_entry` 的写门**只有** `has_user_input`，不看归属 ⇒ 成员会话（跑过一轮、hook 置位后）也会落盘 | `src-tauri/src/live_sessions/cursor.rs:88-90` |
| 3 | 启动恢复 `into_entry` 把归属**硬写成 `User`**，注释声称「团队成员的会话不走这条恢复路径」——没有任何代码实现这条限制 | `src-tauri/src/live_sessions/cursor.rs:136-138` |
| 4 | 恢复出来的行状态是 `Stopped`，点击走 `useActivateSession → recreateSessionTab`，非活会话走 `--resume` 分支（新起进程 + 继承旧身份） | `src/features/live-sessions/utils/sessionTabFactory.ts:60-75` |
| 5 | 侧栏「删除」→ `delete_live_session` → `stop_owning_process`（先 `terminal_router.close_session`，再 chat `Cancel`+`unregister`）→ `unregister_and_notify`。整条编排**没有归属守卫** | `src-tauri/src/app/session_lifecycle.rs:47-110` |
| 6 | 成员进程被杀后团队侧只剩「成员行 `session.live=false`」这一个表现，与「CLI 自己崩了」无法区分 | `src-tauri/src/agent/team/view.rs`（`MemberStatusView.session`） |

第 4 条是危害的具体形态：那条裸 CLI 带着队长 preamble 起来，却调不到任何 `team_*` 工具——它以为自己是队长，
实际没有任何协作能力。

## Requirements

- **R1** 归属为 `TeamMember` 的会话**不得**写入侧栏恢复行（`session_cursors`）。写门仍只有一份实现。
- **R2** `delete_live_session` 拒绝删除归属为 `TeamMember` 的会话：**不结束进程、不摘条目**，返回可读错误。
  成员的生命周期只能由团队域结束（`team_close` / 归档 / 花名册），侧栏不是第二条路径。
- **R3** `cursor.rs::into_entry` 里与实现不符的注释改成事实描述（它现在是错的，会误导下一个人）。
- **R4** 归属为 `User` 的会话，写门 / 恢复 / 删除全部**行为不变**。
- **R5**〔实现期补入：check 阶段发现的第三条可达路径〕`Registry::adopt` 拒绝以团队成员会话作 `from`。
  触发路径：把成员终端 tab 以「后台运行」关掉 ⇒ 条目 `Stopped` 但**进程还活着** ⇒ 从侧栏点回
  那一行 ⇒ `sessionTabFactory` 走「已结束 ⇒ 起新进程 + adopt」⇒ 成员条目被摘掉、进程变成无主孤儿。
  与 R2 同一危害类别，只是触发器不同。

## 约束与已排除的方案

- **不把归属持久化进 cursor**：进程没了就没有可用的入口。恢复团队的官方路径是 `team_resume`，
  它会铸一个**新的** terminal id —— 落库的旧行会永久成为孤儿（正是 `dedupe_restorable` 在防的那类重复行）。
- **不清理历史幽灵行**：`session_cursors` 不存归属，且 `team_member.terminal_id` 已被 v23 迁移删除
  （`src-tauri/src/agent/team/store.rs:345`）⇒ 仓内**没有**可靠判据把旧行与用户会话区分开。
  误删用户会话比留几行残留更糟。这些行由用户手动删除（对 `User` 归属的删除路径仍然有效）。
  待 S3（归属上 wire，任务 `11-17-sidebar-lead-session`）之后重新评估是否值得做一次性清理。
- **不在前端做判断**：`TeamMember` 归属今天**不在** wire 上（`live_sessions/view.rs` 的 `SessionView` 没有该字段），
  前端没有判据可用；本任务的守卫落在后端编排层（红线 6：命令层只调度）。
- **不改前端渲染**（侧栏 team 行属 S3）。

## Acceptance Criteria

- [x] **AC1** 单测：`TeamMember` 条目且 `has_user_input = true` ⇒ `ResumeCursor::from_entry` 返回 `None`；
      同一输入的 `User` 条目仍返回 `Some`。
- [x] **AC2** 单测：注册表登记一条 `TeamMember` 会话并上报用户输入 ⇒ store 里**没有**它的 cursor 行，
      `restore_from_store` 也不会把它投影回侧栏。
- [x] **AC3** 单测：`delete_session` 对 `TeamMember` 会话返回 `Err`，且①进程没有被停（router 仍拥有它）
      ②注册表条目仍在（侧栏行不消失）。
- [x] **AC4** 单测：`delete_session` 对 `User` 会话行为不变（终端 → 关闭 + 摘条目 + `true`；chat 同；未知 id → `false`）。
- [x] **AC5** `cd src-tauri && cargo test live_sessions` 与 `cargo test session_lifecycle` 全绿；
      `pnpm check:quick` 通过。
- [x] **AC6** `.trellis/spec/backend/agent-chat-transports.md` 补上这两条判据（写门排除团队会话、删除守卫），
      `team-domain.md` 的「成员会话登记」小节指向同一条判据（不复制第二份）。
- [x] **AC7**〔R5〕单测：`adopt` 以 `TeamMember` 条目作 `from` ⇒ 返回 `false`，两个条目都还在。

## 遗留（本轮不修，已知且已归档）

- `terminal::commands::close_terminal_session`（→ `TerminalRouter::close_session`）对成员 PTY
  **无归属守卫**。今天从侧栏不可达（成员终端 tab 走 attach，`closeIfOwned` 跳过 attached 条目），
  但将来任何新调用方都能绕过 R2。属于"给关闭入口也加同一道门"的后续工作。
- `tools/guards/checks/check_workspace_identity.py` 冷缓存下会超自己的 10s 预算（实测 11,062ms），
  报「护栏自身失效」；立刻重跑即通过。与本任务无关，但会咬任何冷跑 `check:quick` 的人。

## Notes

- 错误文案给用户看：删除被拒的 toast 会成为用户对「为什么这条删不掉」的唯一解释。
  用 `AppError::Conflict` + 一句能独立读懂的话（团队面板里怎么关）。
- 红线自查：3（无新 IO）· 6（守卫在编排层，命令层不变薄）· 10（无平台代码）·
  13（测试夹具走 `WorkspaceSession::of` 字符串语义，不碰路径敏感 API）。
