# 活性真相与启动契约（liveness & launch）

> 任务：`.trellis/tasks/11-11-team-session-resume`（团队会话恢复）
> 范围：只回答「谁拥有活性 / PTY 启动能不能带 resume / 移除镜像的代价」。
> 不含方案设计。所有结论都带 `file:line`。
> 已建立的背景不再复述（`terminal_id` 是 UI 唯一的「成员没了」信号、无重起路径）。

---

# Q1 — 谁拥有「哪些终端会话还活着」

## 1.1 `live_sessions` 注册表：一个内存 map + 写穿 SQLite

**键是 Neeko 自己的会话 id**（chat = `agent_stream` 返回的 id；terminal = PTY 会话 id），
不是原生会话 id，也不是成员 id。

- `src-tauri/src/live_sessions/registry.rs:28-30` — `Registry { sessions: Mutex<HashMap<String, SessionEntry>> }`
- `src-tauri/src/live_sessions/mod.rs:1-29` — 分层声明：「**会话状态与标题的唯一事实源**」，
  内存唯一事实 + 写穿 `SessionStore`。
- `src-tauri/src/live_sessions/entry.rs:61-113` — `SessionEntry` 全字段：

  | 字段 | 行 | 含义 |
  | --- | --- | --- |
  | `session_id` | :63 | **后端铸造的 id**（chat 的 stream id / terminal 的 PTY id） |
  | `kind` | :65 | `Chat` / `Terminal`（`SessionKind`，entry.rs:23-32） |
  | `agent_id` | :67 | 该会话跑哪个 CLI；纯 shell 为 `None` |
  | `workspace` | :69 | **执行地址**（`WorkspaceSession`，project_id + worktree） |
  | `cwd` | :73 | 已解析执行根 |
  | `state` | :75 | `Ready/Running/AwaitingApproval/Failed/Stopped`（entry.rs:38-49） |
  | `title` / `title_source` | :78 / :80 | 标题只经 `upgrade_title` 单点写（registry.rs:659-685） |
  | **`native_session_id`** | **:89** | **CLI 自己的 session id**，唯一来源 = hook 的 `HookEvent.agent_session_id`（见 :80-90 文档）；**不进 wire 契约** |
  | `started_at` / `updated_at` | :91 / :93 | — |
  | `turn_count` | :95 | — |
  | `has_user_input` | :101 | 用户是否在这个会话里发过输入 = **落盘写门** |
  | `awaiting_user_activity` | :107 | 权威状态门（挡 PTY 字节推断） |

**持久化：有，且跨重启存活**，但只落「出现在侧栏过」的行。

- 写门：`ResumeCursor::from_entry` — `src-tauri/src/live_sessions/cursor.rs:87-118`，
  第一条判断就是 `if !entry.has_user_input { return None }`。
- 表：`session_cursors`（**`~/.neeko/agent_sessions.db`，与团队库不是同一个 DB**）
  - `src-tauri/src/agent/chat/session_store.rs:266-290`（建表，含 `native_session_id TEXT`）
  - `src-tauri/src/agent/chat/session_store.rs:195-197`（`CURSOR_COLUMNS` 唯一列清单）
  - `src-tauri/src/common/paths.rs:54-61`（`agent_sessions_db_path()`）
  - 团队表在 `~/.neeko/neeko.db`（`app_state.rs:653-654` 用 library 的池），
    **两库不同 → 无法 SQL join，只能在 Rust 里跨 manager 问**。
- 启动恢复：`Registry::restore_from_store` — `registry.rs:511-548`；`boot::restore` — `boot.rs:26-34`。
  **恢复出来的状态一律 `Stopped`**（`cursor.rs:125-155`，`state: SessionState::Stopped`），
  不建 tab、不起进程、不 emit。
- 重启后的语义因此是：**行还在，但「活着」这件事完全没有被恢复**。

写穿还有一层「同一 native id 只留一行」的收敛：`dedupe_restorable` — `cursor.rs:170-215`
（按 `(project_id, worktree_path, native_session_id)` 分组留最新）。
**这条逻辑已经承认了「同一条原生会话可以有多个 PTY 会话 id」**——正是 resume 的形态。

## 1.2 live-session 行**不携带任何团队/成员身份**

- `entry.rs:61-113` 没有 team/member 字段；`view.rs:20-58` 的 wire DTO 也没有。
- 全目录 grep：唯一出现 team 的地方是**测试夹具**里显式写
  `team_id: None, team_member_id: None` — `src-tauri/src/live_sessions/wiring/hooks.rs:270-271`。
- 结论：**从 live_sessions 侧无法回答「这条会话属于哪个成员」**。

桥接点只有一处，且是「路过」的：hook 事件的 `EnvHints` 同时带
`neeko_session_id` 与 `team_id`/`team_member_id`
（`src-tauri/src/agent/hooks/ingest/attribution.rs:12-32`），
但两个消费者各取一半：
- live_sessions 只读 `hints.neeko_session_id`（`wiring/hooks.rs:87-93`，`attributed_session`）；
- team 只读 `hints.team_id` / `team_member_id`（`agent/team/observe.rs:82-96`，`attribution_verdict`）。
**没有任何代码把这两个字段一起用**。

## 1.3 「成员 X 有没有活 PTY / 它的原生 id 是什么」——现有读接口

| 问题 | 现成接口 | 证据 |
| --- | --- | --- |
| 这个 PTY 会话 id 还活着吗 | `TerminalRouter::owns_terminal_session(&str) -> bool` | `src-tauri/src/terminal/router.rs:141-146`（读私有 `owners` 表；`SessionOwner` 不暴露） |
| 这条 live session 的原生恢复 argv | `live_session_resume_command(session_id) -> Option<Vec<String>>`（Tauri 命令） | `src-tauri/src/live_sessions/commands.rs:157-179` |
| 任意 (agent, native id) → resume argv | `ConversationManager::resume_command_for_native` | `src-tauri/src/conversation/manager.rs:1010-1019`；per-CLI 数据在 `conversation/adapter.rs:123,129` |
| 成员的原生会话 id | `TeamMember.agent_session_id`（**已经落库**，v21 列） | `agent/team/types.rs:195-201`；迁移 `agent/team/store.rs:295-303` |
| 成员的 live session 条目 | **没有**。`Registry::entry(session_id)` 只在知道 id 时可用（`registry.rs:433-435`），而 live 行没有反向的 member 索引 | — |

**关键不对称**：`Registry::record_native_session_id` 对**每一条**归因到的 hook 事件都无条件记录
（`wiring/hooks.rs:121`，就在 `resolve_title` **之前**）；
而团队的 `note_agent_session_id` 只在**状态类**事件上被调用 ——
`agent/team/observe.rs:98-101` 先 `signal_for(event_key)`，未知/纯信息事件直接 `return`，
`note_agent_session_id`（:145）在任何记录之前就被跳过了。
⇒ **「唯一所有者无条件记录原生会话 id」在团队域今天并不成立**。

## 1.4 退出信号：从 PTY 到 live_sessions，到不了团队域

链路：
```
PTY child.try_wait() == Some(code)                (terminal/services.rs:333, watcher 线程)
  → 摘 pty_handles / sessions / drains             (services.rs:361-374)
  → emit terminal-closed-{id}                      (services.rs:386-390)
  → live_sessions::wiring::pty::exit_and_notify    (services.rs:395-402 / remote.rs:301-307)
      → Registry::apply(Exited|Failed) + unregister (pty.rs:274-289, 291-298)
      → emit SESSIONS_EVENT（只带版本号）           (events.rs:19, 46-51)
```

- `exit_and_notify` 的唯一入口：`src-tauri/src/live_sessions/wiring/pty.rs:291-298`
  （另一个在 `terminal/remote.rs:301-307`）。
- 事件载荷**只有版本号**：`src-tauri/src/live_sessions/events.rs:19-32`
  （`SESSIONS_EVENT = "live-sessions://changed"`，payload `{ version }`）。
- **团队域完全收不到这个信号**：`agent/team/` 里没有任何 `live_sessions` 引用；
  `MemberSignal::Exited`（`agent/team/types.rs:635-636`）在**生产代码里从来没有生产者** ——
  `signal_for`（`agent/team/observe.rs:65-76`）只映射 `turn_completed` / `approval_requested` /
  `input_requested` / `session_failed`。grep 全部 `MemberSignal::Exited` 调用点都在 `#[cfg(test)]`。
- 因此团队成员 `state` 学到「进程没了」的**唯一**途径是：
  1. 显式关闭 → `archive_member` → `MemberState::Dead`（`manager.rs:1555-1600`）；
  2. 租约到期 → `MemberState::Stalled`（`manager.rs:1666-1680`，30s 一拍的 `reaper`）。
  进程崩了而租约未到期时，花名册仍显示旧状态（如 `Idle`）。
- **PTY 自然退出会把 `session_cursors` 行删掉**（不是标 Stopped）：
  `pty.rs:439-480` 的 `natural_exit_deletes_the_row_while_an_explicit_close_keeps_it`
  （路径 A `on_exit` → `unregister` → `delete_cursor`；路径 B 关 tab → `close_and_notify` 只标 `Stopped`）。
  ⇒ 一个**崩溃**的成员 PTY 在 live_sessions 里**连行都不剩**，身份只剩
  `team_member.agent_session_id`。

## 1.5 terminal 域自己有的东西（与 live_sessions 是两套表）

`src-tauri/src/terminal/`：

| 表 | 位置 | 内容 | 何时删 |
| --- | --- | --- | --- |
| `sessions: HashMap<String, TerminalSession>` | `terminal/manager.rs:53-57` | 会话元数据 | 退出 watcher：`services.rs:377` |
| `pty_handles: HashMap<String, PtyHandle>` | 同上 | **真进程句柄**（master + child，Windows 还有 Job Object） | watcher `services.rs:361-374` / 关闭 `manager.rs:296-345` |
| `drains: SessionDrainMap` | 同上 | 输出缓冲 | `services.rs:381`（先 close 再 remove） |
| `owners: HashMap<String, SessionOwner>` | `terminal/router.rs:52` | 会话 → Pty / Ssh | `close_session` 的 `take_owner`（router.rs:339-352） |

live_sessions 只是**这些原语事的投影 + 持久化**：`LiveTerminal::register` 在进程创建成功后
立刻登记（`pty.rs:151-165`），退出时注销。注册表的注释明确写了它的承诺：
「只观察信号，不拥有进程」（`app/session_lifecycle.rs:13-16`）。

## 1.6 谁是活性真相

**`TerminalRouter::owns_terminal_session`（= `owners` 表命中）是唯一的生产级活性判据。**

理由链：
1. `owners` 与 `pty_handles` 的生命周期与真进程同时开始、同时结束
   （登记在 `router.rs:187-260` 各分支的 `self.register(...)`；移除在 `take_owner`）。
2. live_sessions 的行**故意可以活得比进程长**：关 tab 保留 `Stopped` 行当「点回来」入口
   （`live_sessions/lifecycle.rs:42-46`，`pty.rs:274-289` 认得这条尾巴）。
3. live_sessions 的行也可以在进程活着时不存在（`has_user_input == false` 就不落盘，
   `cursor.rs:87-90`）——团队成员 PTY 刚起来时正是这种形态。
4. 重启后 live_sessions 的行**全部**是 `Stopped`（`cursor.rs:141`），
   而 `owners` 表是空的 —— 两者都说「没有活进程」，但只有后者是「真的」。

⇒ 任何「这个成员还有没有进程」的判断都**必须**问 terminal 域，不能读 live_sessions，
更不能读 `team_member.terminal_id`。

---

# Q2 — PTY 启动契约：能不能带「resume 这个原生会话」

## 2.1 `TerminalLaunch`（真身是 struct，不是枚举）

`src-tauri/src/terminal/launch.rs:10-33`（7 个字段，全部由调用方一次成型）：

| 字段 | 行 | 含义 / 约束 |
| --- | --- | --- |
| `cols` / `rows` | :12 / :14 | PTY 尺寸 |
| `shell` | :16 | shell 覆盖（**仅本地**；WSL/SSH 由远端决定） |
| `command` | :18 | **一段 shell 命令行**（任务终端）。由 `platform::shell_launch::build_task_command` 包 `sh -c` / `cmd /c` |
| **`resume_from`** | **:20** | 原文：「纯 shell 会话恢复时的旧 `session_id`；由 router 用它准备回放计划」 |
| `argv` | :27 | **直接 argv**（不经 shell）。与 `command` 互斥（守卫在 `router.rs:374-378`）。存在理由就是团队成员的 `--mcp-config` JSON 引号 |
| `extra_env` | :32 | 调用方注入 env；**仅本地**传输生效；IPC 边界恒传空 |

**两个同名的 `TerminalLaunch`**：`terminal/manager.rs:74-82` 还留着一个
`enum TerminalLaunch { Shell(String), Argv(Vec<String>) }` ——
**全仓零引用，是死代码**（`create_session` 的签名用的是 `crate::terminal::launch::TerminalLaunch`，
`manager.rs:133` / `:216`）。`implement.md` C9 描述的落地形状仍停在这个枚举上。

## 2.2 `resume_from` 到底做什么：纯 shell 的历史回放，与 resume 无关

- 唯一消费点：`TerminalRouter::prepare_history` — `terminal/router.rs:110-124`
  ```rust
  if !plain_shell { return Ok(None); }        // agent TUI 直接 None
  store.prepare(resume_from.as_deref())       // 读旧 session 的日志尾巴
  ```
- `prepare` 的实现：`common/terminal/history/store.rs:95-105`
  —— `read_tail(old_session_id)` → `replay_payload(&seed)`，产出 `HistoryPlan { replay, seed }`。
- 该 plan 只被当作写线程的 seed（`store.rs:110-113` `start_writer(session_id, seed)`），
  即**把上一次的终端字节重新灌进新 PTY 的显示缓冲**。
- `resume_from` **不参与任何 argv**：`manager.rs:130-194` 建 `CommandBuilder` 的三条分支
  （`command` / `argv` / 默认 shell）里都没有它。
- 单点裁决：三个传输（Local/WSL/SSH）共用同一份 plan（`router.rs:110-124` 的注释 + 用例
  `prepare_history_is_single_gate_for_all_three_transports`，`router.rs:484-520`）。

⇒ **确认：`resume_from` = 纯 shell 历史回放，不能当 resume 通道。**

## 2.3 `team_executor::spawn` 怎么造 launch

`src-tauri/src/app/team_executor.rs:81-250`：

```
端点 URL            state.team_endpoint_url()            :86-92
成员行 / 团队行      member_and_team(&state, member_id)    :95 / :336-352
项目环境            execution::environment_source(&team)  :106-111
程序名              program_for(&state, &member.agent_id)  :115 / :602-620（AgentManager.command，含用户覆盖）
启动计划            execution::plan_member_spawn(...)      :128-147（阻塞池）
配置目录 provision    provision_config_dir(...)             :153-176（阻塞池，唯一 fs/进程副作用）
argv               launch_argv(program, args, &member)    :179 / :355-370
env 三份合流        env + credentials_env + cfg.add_env      :184-188
create_session      terminal_router.create_session(...)    :213-233
回填 terminal_id    manager.set_member_terminal(...)       :238-244
```

`SpawnPlan` 的五份产物（`agent/team/execution.rs:68-93`）：
`cwd` / `env`（身份，`identity::member_env`）/ `args`（MCP 注入档的渲染 argv）/
`credentials_env`（**含密**）/ `config_dir`（`ConfigDirPlan` 副作用计划）。

`launch_argv`（`team_executor.rs:355-370`）= `[program] ++ mcp_args ++ bypass_args`。
**resume argv 必须插进这个列表**，且必须是 argv 形态（不能退回 `command`，红线 2）。
可插的物理位置只有这一处：`team_executor.rs:179` 的 `launch_argv(...)` 及其上游
`SpawnPlan::args`（`execution.rs:196-238`，`match admission.mcp_injection`）。

> ⚠️ **顺序不是自由的**：codex 的 resume 是**子命令** `codex resume <uuid>`
> （`conversation/adapters/codex.rs:255-257`），而 codex 的 MCP 注入是 `-c key=value` 旗标、
> 角色 preamble 是**位置参数**（`agent/team/admission.rs:634-661`）。
> 现在前端拼的是 `<command> <args…> <resumeArgs…>`（`src/shared/utils/agentCommand.ts:51-57`
> `buildResumeTaskCommand`），对 codex 会拼出
> `codex -c … "<preamble>" resume <uuid>` —— 子命令跑到位置参数之后，argv 语义已变。
> 逐 CLI 的 argv 装配只能落在数据表（红线 15：per-CLI 差异只允许在 `admission` /
> `HookTarget` / adapter 里）。

## 2.4 argv 与 env 是否完全由调用方决定？——是（但有几处不可绕过的注入）

`TerminalManager::create_session` — `terminal/manager.rs:130-200`：

| 步骤 | 行 | 谁决定 |
| --- | --- | --- |
| `command` 分支 | :153-159 | 平台包装（`platform::shell_launch::build_task_command`，红线 2 的集中点） |
| `argv` 分支 | :160-176 | **完全调用方**：`CommandBuilder::new(argv[0])` + `builder.args(&argv[1..])`，**没有 shell、没有引号规则** |
| 默认分支 | :177-179 | `build_local_shell_cmd(&launch.shell)` |
| `TERM` / `COLORTERM` | :181-182 | 层内置 |
| **`NEEKO_SESSION_ID = <新 PTY id>`** | **:185** | **PTY 层强制写**（本地）/ WSL `export` 前缀（:243-247）/ SSH `remote_shell_prefix`（`services.rs:264-274`） |
| locale env | :187 | `platform::shell_launch::apply_locale_env` |
| **`extra_env`** | **:188-191** | **调用方，且在最后** ⇒ 显式值优先于内置值 |
| `cwd` | :192 | 调用方 |

三条不能绕过的约束：
1. **`NEEKO_SESSION_ID` 永远是新 id**（PTY 层写，`manager.rs:185`）。resume 之后
   hook 归因会落到**新** session id 上 —— 这正是 `dedupe_restorable` 存在的前提
   （`cursor.rs:159-168` 注释）。原生 id 不变、neeko id 变，是 resume 的固有形态。
2. **`extra_env` 只在 Local 生效**：`router.rs:388-395` 的 `ensure_launch_valid` 对
   WSL/SSH 直接 `Unsupported`（「变量进不去内层进程，静默丢弃会让成员的上报没有身份」）。
   ⇒ 团队成员的 resume 在 WSL/SSH 上今天**根本起不来**（`team_spawn` 同样受这条约束）。
3. `command` 与 `argv` **互斥**（`router.rs:374-378`），`argv` 空列表被拒（:379-387）。

## 2.5 每成员凭证：签发 / 下发 / 生命周期

**签发链**（一次 `admit` = 签发 + 认门，不可拆）：
```
execution::start_member                       agent/team/execution.rs:1055-1065
  → CredentialLedger::admit(member_id)        execution.rs:524-538（trait）
      → TeamServerState::admit                mcp/server.rs:136-151
          → TeamManager::issue_token          manager.rs:1031-1054
              token = uuid v4 simple (32 hex) identity/token.rs:20-22
              member.token_hash = sha256(token) identity/token.rs:29-36
              store.upsert_member(member)     manager.rs:1041
          → refresh_credentials（从库重组身份表 + 换门） mcp/server.rs:111-123, 153-163
  → MemberExecutor::spawn(member_id, token)   execution.rs:1060-1064
```

- 明文 token 的三条落地路径（都在 `spawn` 内一次性完成）：
  1. **argv**：`--mcp-config <json>` / `--header x-neeko-team-token=…` /
     codex 的 `bearer_token_env_var`（`admission.rs:600-800` 各行的 `mcp_argv`）；
  2. **env**：仅 `bearer_token_env_var` 那一族，走 `SpawnPlan::credentials_env`
     （`execution.rs:75-87` 的文档把这条写成「唯一例外」），env 名唯一常量
     `NEEKO_TEAM_TOKEN`（`identity/env.rs:31`）；
  3. **文件**：`McpInjection::ConfigDir`（pi）由 CLI 自己的 `mcp add` 把 token 写进
     `{state_root}/team/{team}/{member}/mcp.json`
     （`execution.rs:260-281` 的 `config_dir_plan` + `team_executor.rs:549-590` `run_add_command`）。
- `token_hash` 的读者只有身份表组装：`mcp/principals.rs:33-50`（`hash → TeamPrincipal`，
  **过滤空 hash** ⇒ 空 hash = 不可认证）。前端**拿不到** `token_hash`（wire 里没有）。
- 作废：`archive_member` 把 `token_hash` 清空（`manager.rs:1583`），随后端口 `refresh` 才会
  **忘掉**旧 hash（`execution.rs:528-537` 的注释解释了为什么 `refresh` 必须独立于 `admit`）。

**语义裁决：token 是「per-process」，不是「per-member-forever」。**
- 每次 `admit` 都 `uuid::new_v4()` **轮换**（`manager.rs:1039`），旧明文立刻失效
  （`identity/token.rs` 用例 `wrong_or_empty_token_resolves_to_none` 明确断言「旧 token（重新签发后）必须失效」）。
- 没有任何「读回明文」的接口：库里只有 hash（`types.rs:221`，`store.rs:78` `token_hash TEXT NOT NULL`）。
- ⇒ **给现有成员重新发 token 的代价 = 再跑一次 `admit` + 把新值的全部三条落地路径重做一遍**，
  其中 `ConfigDir` 档还要重跑该 CLI 自己的 `mcp add`（`team_executor.rs:549-590`）。
  已经跑着的进程**无法**接受新 token（CLI 只在启动期读 MCP 配置）。

**端点坐标也是短命的**：`TeamServer` 每次 boot 都 `bind 127.0.0.1:0` 由 OS 分配端口
（`agent/team/boot.rs:102-104`），且 `boot.rs:17-30` 明确写着「重建 listener 会换端口，
已下发到成员 MCP 配置里的 URL 全部失效（`--mcp-config` 只在启动时读）」。
⇒ **重启后所有历史成员会话的 MCP 坐标都过期了，必须用当前 URL + 新 token 重起。**

## 2.6 团队域今天拿不到「该成员的原生 id」的完整答案（三个断点）

1. `note_agent_session_id` 只在状态类 hook 上被调用（见 §1.3 的不对称）。
2. `plan_member_spawn` 的入参里**没有 native id**：`execution.rs:142-149` 的签名是
   `(team, member, mcp_url, token, state_root, member_count)` ——
   要用 `member.agent_session_id` 就得从 `member` 里读（字段在，只是没人用）。
3. 团队域**不认识** `ConversationManager`（per-CLI resume 能力表的持有者），
   依赖方向要求这件事发生在组合根（`team_executor.rs:1-15` 的模块文档就是这条判据）。

---

# Q3 — 移除「存的镜像」的代价

## 3.1 Rust 里 `TeamMember.terminal_id` 的**全部**读者（按用途）

**写入口（2 处）**
| 位置 | 作用 |
| --- | --- |
| `agent/team/manager.rs:687-730` `set_member_terminal` | 回填；允许覆盖；**队长同时写 `team.lead_session_id`**（:709-717） |
| `agent/team/manager.rs:1572-1590` `archive_member` | 归档时清空（与 `Dead` + `token_hash=""` 同一次写） |

**读：进程控制（2 处，都在组合根 `app/team_executor.rs`）**
| 位置 | 用途 | 失效形态 |
| --- | --- | --- |
| `team_executor.rs:253-300` `deliver` | `None` → `Unsupported`；否则 `delivery::deliver_via_pty` 往 `terminal-input-{id}` emit | 有 id 但会话死了：`emit_write` 只是往一个没人听的事件名发字节，**静默成功**（`delivery.rs:150-168`；错误文案「the session may have exited」只在 emit 本身失败时才出现） |
| `team_executor.rs:308-345` `close` | `close_session(&terminal_id, …)`；`None` → `Ok`（幂等） | 有 id 但会话死了：`close_session` 返回 `false`（`router.rs:339-352`），内部只 info 日志，仍 `Ok` |

**读：UI gating（2 处）**
| 位置 | 用途 |
| --- | --- |
| `agent/team/view.rs:642` | `MemberStatusView.terminal_id`（唯一投影点） |
| `agent/team/commands.rs:188-203` | `start_team_session` 返回 `TeamSession.terminal_id` 给前端接管队长终端 |

**读：其它**
| 位置 | 用途 |
| --- | --- |
| `agent/team/manager.rs:1357-1362` `begin_team_close` 文档 | 「`Dead` 不说明 terminal_id 指向的会话真的不在了 —— 那是 terminal 域的事实，本域看不到」（**已经在承认这条镜像不可靠**） |
| `agent/team/execution.rs:484-505` | `MemberExecutor::close` 契约（幂等三态，`terminal_id` 是其中之一） |
| `agent/team/store.rs:69,541,550,571` | 列 + upsert |
| `agent/team/fixtures.rs:111,185`、`bootstrap.rs:153`、`mcp/dispatch.rs:559` | 夹具 / 初始 `None` |

**没有出现在任何业务判定里**：`terminal_id` 不参与成员状态迁移、不参与授权、
不参与租约、不参与 `MemberSignal`。它只服务「打开/投递/关闭」这三件与进程相关的事。

## 3.2 Rust 里 `token_hash` 的全部读者

| 位置 | 用途 |
| --- | --- |
| `mcp/principals.rs:33-50` `principals_from` | **唯一读点**：`hash → TeamPrincipal` 表，空 hash 被过滤 |
| `mcp/principals.rs:61` `token_hashes` | 表的 key 集合 → 门的 `SharedTokenSet` |
| `agent/team/boot.rs:107` | 启动时装门 |
| `mcp/server.rs:111-123` `refresh_credentials` | 重装表 + 换门 |
| `agent/team/identity/preamble.rs:463-467` | **反证用例**：断言 `token_hash` 绝不进模型上下文 |
| `manager.rs:1031-1054` / `1583` | 唯一写点 / 唯一清点 |
| `store.rs:78,542,559,580,969` | 列 + 读写 |

前端：**零读取**（`grep tokenHash src/` 无结果）。

## 3.3 前端 `terminalId` / `tokenHash` 的全部读者

`tokenHash`：**无**（wire 里根本没有这个字段）。

`terminalId`（7 个文件，全部是 UI gating / 打开终端）：

| 文件:行 | 用途 |
| --- | --- |
| `src/features/agent-team/utils/memberTerminal.ts:80-90` | **唯一判据函数** `openTerminalAction(member)`：`terminalId != null` ⇒ `{kind:'live'}`；否则 `agentSessionId` 非空 ⇒ `{kind:'archive'}`（打开 conversation tab）；都空 ⇒ 置灰 + 可见理由「暂无会话」 |
| `src/features/agent-team/components/RosterRow.tsx:81-95` | 行内按钮调用同一判据 |
| `src/features/agent-team/components/MemberApprovalQueue.tsx:37-43` | 同 |
| `src/features/agent-team/components/MemberDetailDrawer.tsx:103-105` | 同 |
| `src/features/agent-team/components/TeamRoster.tsx:26` / `TeamView.tsx:53` / `TeamPanel.tsx:82` | 参数透传 |
| `src/app/dock/wrappers/TeamPanelWrapper.tsx:40-73` | `terminalId` → `openExistingTerminalTab(projectId, terminalId, …)` → `attachSessionId`（`useTerminalTabs.ts:109-140`），此时**不发 `create_terminal_session`** |
| `src/features/agent-team/hooks/useStartTeam.ts:81-91` | `terminalId == null` ⇒ toast「队长进程没有落地」 |
| `src/shared/types/team.ts:263,573` | 类型 |

关键点：**`terminalId == null` 也是「该给什么动作」的唯一分叉**（`memberTerminal.ts:80-90`）。
花名册目前**没有第三条腿**（「按原生 id 重起一个成员进程」）。

## 3.4 持久化后跨重启真的被用到吗？—— 是，而且是**错的**

- `set_member_terminal` → `store.upsert_member`（`manager.rs:704-717`）。
- 重启 `TeamManager::load`（`manager.rs:360-387`）**原样**把行读回内存镜像，
  **没有任何 reconcile**（`manager.rs:1307-1362` 明确写「`Dead` 不说明 `terminal_id` 指向的会话真的不在了」）。
- 于是重启后：
  - `memberTerminal.openTerminalAction` 看到非空 `terminalId` ⇒ 显示「打开会话」**可点**；
  - 点下去 → `openExistingTerminalTab` → TerminalView 走 `attachSessionId` 不发 create →
    `terminal_drain_wait`/`drain` 对未知 id 返回 `NotFound`（`router.rs:280-310`）；
  - `team_send` 的投递路径**静默成功**（往无人听的事件名 emit，见 §3.1）。
- 另一半更糟：`Team.lead_session_id`（`types.rs:37`，`store.rs:50` `NOT NULL`）
  在重启后仍是旧 PTY id，同样是死句柄。

⇒ `terminal_id` 的语义实际上是**「write-once-at-spawn，之后一直陈旧」**：
它的「有效窗口」只有本进程生命周期内，而**持久化让它跨过了这个窗口**。

## 3.5 已有「问另一个域」的读接口 / 红线 17 合规先例

| 先例 | 位置 | 形态 |
| --- | --- | --- |
| 归属探测编排 | `app/session_lifecycle.rs:66-116` | 组合根依次问 `terminal_router.close_session` / `chat.get(id)`，**不复制任何终止规则**；模块文档 :14-24 明说「归属探测而不是 `kind` 分支」 |
| 终端活性探测 | `terminal/router.rs:141-147` | `owns_terminal_session` 是 `pub`，唯一外部语义是「要不要先结束进程」；`SessionOwner` 保持私有，防止第二份路由判定 |
| 能力表外包 | `live_sessions/commands.rs:157-179` | `live_session_resume_command` 把「这个 agent 支不支持 resume」**交给** `conversation_manager.resume_command_for_native`，前端不维护能力表（红线 17 的正例：不造影子副本） |
| 环境外包 | `app_state.rs:282-300` | 团队行只存 `project_id`，环境仍向项目库要（「复制就是给同一份秘密造第二个存放点」） |
| 线程池 / DB 共享 | `app_state.rs:87-99` | 三个域共享同一个池（**但 team 与 live_sessions 是两个 DB**，见 §1.1） |

**缺失的那一条**：没有任何接口能回答「这条 live session 是不是某个成员的 PTY」。
缺的**不是**活性探测（`owns_terminal_session` 已有），而是**关联键**
（member id ↔ session id ↔ native id 三者的映射）。

---

# 这批事实隐含的 6 条最硬约束（不含方案）

1. **活性与持久化必须彻底分家。**
   只有 `TerminalRouter` 的 `owners` 表（进程句柄生命周期）能回答「还活着」；
   live_sessions 的 `state` 与 `team_member.terminal_id` 都是**可以跨过进程死亡**的快照
   （`cursor.rs:141` 强制 `Stopped`；`manager.rs:360-387` 原样 hydrate）。
   任何把「行存在」当成「活着」的判据都会在重启后撒谎。

2. **resume 的 argv 装配是逐 CLI 的知识，且顺序敏感。**
   `codex resume <uuid>` 是子命令，而 codex 的 MCP 是 `-c` 旗标、preamble 是位置参数
   （`admission.rs:634-661`）；`claude --resume` 是旗标（`claude_code.rs:259-261`）。
   现有前端拼法 `<command> <args…> <resumeArgs…>`（`agentCommand.ts:51-57`）对 codex 是错的。
   ⇒ 「resume + MCP + preamble」的 argv 顺序只能由 per-CLI 数据表回答（红线 15），
   而且必须走 **argv 形态**（红线 2：不能退回 `sh -c` / `cmd /c`，`--mcp-config` 的 JSON 会炸）。

3. **原生会话 id 是唯一能跨重启的身份，但它今天的写入是不完整的。**
   `live_sessions` 对每条归因事件无条件写（`wiring/hooks.rs:121`）；
   团队域只在**状态类** hook 上写（`observe.rs:98-101` 提前 return 挡在 `note_agent_session_id` 之前）。
   没有 hook 的 CLI（C 档，`admission.rs:661-700`）永远拿不到原生 id ——
   对它们「按原生 id 恢复」不存在，必须有别的（或显式的「不支持」）答案。

4. **「credential」与「endpoint」都是 per-process 的一次性资源，无法复用给一个新进程。**
   `admit` 每次都轮换 token（`manager.rs:1039`），库里只有 hash（无读回路径）；
   MCP 端口每次 boot 随机（`boot.rs:102-104`），而 `--mcp-config` 只在 CLI 启动期读。
   ⇒ 任何「恢复一个成员」的动作，实质上都是**重新走一遍 admit + provision + spawn**，
   而不是「重新 attach 到旧的东西」。

5. **团队域与 live_sessions 之间没有关联键，而且它们不在同一个数据库里。**
   `entry.rs:61-113` 无 team 字段；`neeko.db` vs `agent_sessions.db`（`paths.rs:54-61`）
   ⇒ 既不能 SQL join，也不能靠「id 形状」猜。关联只可能来自
   (a) 团队行里已有的 `agent_session_id`（`types.rs:195-201`，v21 列），或
   (b) hook 事件里同时到达的 `EnvHints { neeko_session_id, team_id, team_member_id }`
   （`attribution.rs:12-32`，今天被两个消费者各取一半）。

6. **`terminal_id` 的删除不是「去掉一列」，而是把三个动作改问另一个域。**
   投递 / 关闭 / 打开终端（`team_executor.rs:253-345`、`view.rs:642`、
   `memberTerminal.ts:80-90`）今天都从这一列派生。改成「问终端域」时，
   前两个可以直接用 `owns_terminal_session` 判活，第三个需要一条
   **UI 可解释的降级**（`memberTerminal.ts` 的三态已经留了 `archive` 这条腿，
   但没有「按身份重起」这条腿）。

---

# 附录 A — 顺带发现的偏差（不属本任务，但影响设计判断）

1. **`terminal::manager::TerminalLaunch` 枚举是死代码**（`manager.rs:74-82`）。
   全仓零引用；真正在用的是 `terminal::launch::TerminalLaunch` struct。
   `implement.md` C9 与 `team-domain` 相关注释仍按枚举描述。
2. **`listLiveSessions(workspace?)` 的 `workspace` 参数已不被后端接受**
   （前端 `liveSessionsApi.ts:35-39` 传；后端 `live_sessions/commands.rs:41-48` 的签名只有
   `state`，注释明确说「曾经的 `workspace` 参数从未被调用方使用，故删除」）。
3. **`team_member.session_id`（Chat 成员位，`types.rs:193-194`）恒 `None`**，
   `bootstrap.rs:151-153` 注明「本期恒 `None`」——将来 Chat 成员的会话身份是**第三个**
   要恢复的东西。
4. **`terminal_id` 失效时投递静默成功**（`delivery.rs:150-168`）：`emit_write` 只往
   `terminal-input-{id}` 事件名发字节，没有监听者的表现是「什么都没发生，也没有错误」。
   这会把「恢复失败」伪装成「成员不响应」。
5. **成员 PTY 登记的 workspace 是「团队项目的 checkout」，不是成员实际 cwd**
   （`team_executor.rs:196-200`：`WorkspaceSession::of(team_project_id, None)`，
   cwd 另给）。所以「历史会话按项目身份而不是路径字符串归属」（PRD Goal）在
   live_sessions 侧今天已经是「按项目」的口径，但 worktree 维度被丢掉了
   （`dedupe_restorable` 却按 `(project_id, worktree_path, native)` 分组，`cursor.rs:170-215`）。
