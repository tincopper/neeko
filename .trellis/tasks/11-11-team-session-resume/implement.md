# 执行计划：团队会话恢复（S1 → S2 → S3）

> 纪律：每个阶段是**可独立验收**的交付物；阶段内 TDD（Red 先写、单文件观察红绿），
> 阶段收尾只跑一次 `pnpm check:quick`。`.rs` 改动不在 `check:quick` 的覆盖里 ⇒
> 阶段内自己跑 `cargo test --lib <module>` 观察，全量 `cargo test` 交给 push/CI。
>
> **阶段顺序不可交换**：S1 删掉的两个列是 S2 的前置（没有 durable 原生 id 就没有 resume），
> S3 是「旧成员历史入口」的补回路径（否则 S1 的删列对用户是一次净损失）。

---

## S1 — 会话身份归位（数据模型 v22 + 归属键 + boot 归位）

### S1.1 契约先行（先写类型，不写实现）

- [x] `live_sessions`（或 terminal 域，与 owners 表现有落点同处）新增 `SessionOwner`
      + 在 `TerminalRegistration` 上加 `owner`；`User` 为所有既有调用点的显式值。
- [x] `agent/team/types.rs`：`MemberState::Dead → Offline`；新增 `TeamMember.sealed_at`
      （**不是** `MemberState` 的变体）；`TeamState::Closed → Sealed`、`Active → Open`。
- [x] `MemberSession` + `MemberSessionLookup` trait（`agent/team/view.rs` 消费）；
      生产实现放 `app/`（组合根装配 terminal router + live_sessions registry）。

### S1.2 Red

- [x] `observe` 回归：`session_started`（未知键）也必须记录原生 id；对照用例
      「未知键仍然不产生 signal / 不动水位线」保持绿。
- [x] `reconcile`：seed 一个 `active/closed` 队 + 4 种成员态 + 非空 `token_hash` ⇒
      reconcile 后 `open/offline`、hash 全空、`closing → open`、每队一条审计。
- [x] `view`：花名册行不再从 `TeamMember` 读 `terminal_id` / `agent_session_id`，
      改问 `MemberSessionLookup`（用假实现喂 4 种组合）。
- [x] `team_send` 对 `offline` 成员 ⇒ `Conflict`（今天静默成功）。

### S1.3 Green（按依赖顺序）

- [x] v22 迁移（`agent/team/store.rs`）—— 一次事务、`ALTER TABLE ... DROP COLUMN`、
      `UPDATE` 值合法化；迁移测试断言**迁移后**的 `list_members` 形状。
- [x] `manager.rs`：删 `set_member_terminal`；`archive_member` 只写 `sealed_at` + 清 hash；
      `note_agent_session_id` 整条删除（身份归会话域）。
- [x] `observe.rs`：把 `note_agent_session_id` 调用点移到**事件键判定之前**
      （`signal_for` 的 `None` 分支不再 return 掉记录动作）。
- [x] `boot.rs`：`reconcile()`（纯写入口，带审计）。
- [x] `app/team_executor.rs`：`deliver` / `close` 改用 `MemberSessionLookup` 的
      `terminal_id`（活性来自终端域），不再读团队行。
- [x] 前端：`MemberStatusView` 换成 `{ live, terminalId, nativeSessionId, sealed }`
      四字段；`memberTerminal.ts` 四态判据；`RosterRow` 渲染四态文案。
- [x] 前端：`TeamListRow` / `TeamHeader` / `TeamStateBadge` 的 `closed → sealed` 文案。

### S1.4 阶段门

```bash
cargo test --lib agent::team           # 模块级观察（含迁移与 reconcile）
cargo test --lib live_sessions
pnpm vitest run src/features/agent-team
pnpm check:quick                       # 收尾一次
```

- Review gate：`grep -rn "terminal_id\|agent_session_id" src-tauri/src/agent/team/`
  必须只剩「读接口调用」与迁移注释；`view.rs` 里零 `member.terminal_id`。
- Rollback point：v22 迁移是提交的**第一个** commit（前置可单独 revert 评估）。

#### S1 实施记录（2026-11-11 完成）

验收数字：`cargo test --lib` **3241 passed / 0 failed**；`npx vitest run` **7500 passed**；
`pnpm check:quick` **29/29 护栏通过**。

四处与计划的**有意偏差**（都以「一条事实一个主人」为准，已同步进 spec §5a）：

1. **`agent_session_id` 保留在成员行上**（原计划「身份归会话域、团队域不再存」）。原因：
   `live_sessions` 在**自然退出**时整行删除（`on_exit`），所以它不能当持久 id 的主人；
   而 `team_resume` 需要的正是「进程没了之后还记得它叫什么」。故只有真正的进程资源出列：
   `team_member.terminal_id` 与 `team.lead_session_id`。
2. **归属键叫 `SessionAttribution`（`live_sessions::entry`），不是 `SessionOwner`**：`router`
   里已有一个私有 `SessionOwner` 表示「哪个后端拥有这条会话（Pty/Ssh）」，同名会造出两个意思。
3. **活性判据是注册表条目状态，不是 `TerminalRouter::owners`**：自然退出不摘 `owners`，
   拿它当活性会得到「死会话可点」。新增 `Registry::live_session_for_member`（`!is_terminal()`）。
4. **`reconcile` 落在 `TeamManager::reconcile_boot`**（不是独立 `team::boot::reconcile`）：
   它要私有 `Inner` 与 `audit`，一次锁内写完成员 + 团队 + 审计才没有中间态。
   组合根调用点仍在 `app::boot`，且**在端点 boot 之前**（否则身份表会装上幽灵 token）。

`team_send` 的离线分支：判据放在 `dispatch`（模型拿到可行动的 `Conflict` + 指向 `team_resume`），
执行层 `deliver` 保留同一条守卫（竞态兜底）。

---

## S2 — 恢复是一等操作（resume argv + `team_resume`）

### S2.1 argv 形态（先定事实，再写代码）

- [x] **smoke test（人工，一次性）**：对已安装的 CLI 逐个验证「resume 片段的位置」。
      2026-11-11 实测（`<cli> --help` / `<cli> resume --help`）：

      | CLI | 片段 | 位置 | 结论 |
      | --- | --- | --- | --- |
      | claude | `--resume <id>` | 全局 flag，位置自由 | **prefix** |
      | codex | `resume [OPTIONS] [SESSION_ID] [PROMPT]` | `resume` 是**子命令**，它自己的 `-c key=value` 跟在后面 | **prefix**（`["resume", id]`）|
      | pi | `--session <path\|id>` | 全局 flag | **prefix** |
      | reasonix | `run --resume <PATH>` | 位置在 `run` 之后、positional 之前 | 不进成员路径（准入表 `prompt_argv` 为空 ⇒ `launch_refusal` 恒拒）|
      | qoder / gemini | `-r, --resume [id]` / 无 | qoder 只在 `--print` 下有效；gemini 无 resume | **不支持**（`None`）|

      ⇒ **今天所有能当成员的 CLI 都是 prefix**。「resume 追加在末尾」的旧做法对 codex
      是**错的**（`codex --mcp-config ... resume <id>` 会把 `resume` 当成 prompt）。
- [x] ~~`conversation::Adapter` 新增 `resume_argv(&self, native_id) -> Option<ResumeArgv>`~~
      ⇒ **偏差 A**：每个 adapter 的 `resume_command(native_id, project_path)` **本来就返回
      这个片段**（10 个都核过，不含程序名），所以只加了一个查表入口
      `conversation::adapters::resume_argv_for(agent_id, native_id, project_path)`。
      `ResumeArgv { prefix, suffix }` 没有生产者也没有消费者（红线 14）—— `suffix` 恒空。
- [x] Red：`resume_argv_for` 的**逐 CLI 台账**（覆盖 `ADMISSIONS` 全表；codex 必须是
      `["resume", id]`）+ 片段不含程序名 + `launch_argv` 组合顺序断言（片段紧跟 program，
      `resume=None` 逐字节等于旧输出）。

### S2.2 重建资源

- [x] `execution::start_member` 增 `resume_argv: Option<Vec<String>>`；
      `plan_member_spawn` 把它放在 argv **最前面**（`bypass_args` 同批从 `app::team_executor`
      移入，见偏差 C）；**三相位不变**（admit → provision → spawn）。
- [x] Red：`resume=None` 与 `resume=Some(id)` 的 plan 差异只有 argv 片段（cwd / env /
      credentials_env / config_dir 全等）+ 逐成员 `resume_member` 审计 detail。
- [x] `team_resume` 命令 + `TeamResumeReport`（语义在 `agent/team/resume.rs`，命令是 5 行适配）；
      Red：已 live 跳过（幂等）、`Sealed` / `Closing` 团队拒绝、`cold` 点名、逐成员失败不吞。

### S2.3 前端第三态

- [x] `memberTerminal.ts` 增加 `kind: 'resume'`；`TeamPanel`/`RosterRow` 接
      `team_resume`（单个成员恢复 + 全队恢复两个入口，文案不同）。
- [x] Red：五态渲染 + 点击派发（`team_resume` 的 payload 只带 `teamId`，成员级走同一命令后
      过滤结果；不新增第二个命令名）。—— 实施期修正：命令收**可选** `member_id`（None = 整队），
      所以成员级恢复不会顺手起整个队；仍是同一个命令名（见 §S2 实施记录 偏差 B）。

### S2.4 阶段门

```bash
cargo test --lib agent::team::execution     # argv 组合与 resume 入参
cargo test --lib agent::team::commands
cargo test --lib conversation::adapters      # resume_argv
pnpm vitest run src/features/agent-team src/features/terminal
pnpm check:quick
```

- Review gate（红线 15）：`grep -rn "resume" src-tauri/src/agent/team/ | grep -v test`
  不得出现按 `agent_id` 分支的 resume 逻辑（差异必须在 adapter/准入表）。
- Review gate（红线 14 的精神）：`ResumeArgv` 的每个字段都必须有消费点；
  没有 suffix 消费者的 CLI 不许留空实现以外的声明。
- Rollback point：`team_resume` 命令与前端入口可分两个 commit（后端可先合，UI 后开）。

#### S2 实施记录（后端半，2026-11-11 完成）

验收数字（`src-tauri`）：`cargo test --lib` **3267 passed / 0 failed / 11 ignored**
（= S1 基线 3241 + 本阶段新增 26）；分模块 `agent::team::resume` 13 ·
`agent::team::execution` 38 · `agent::team::manager` 64 · `agent::team::view` 33 ·
`agent::team::commands` 9 · `conversation::adapters::registry` 10；
`cargo fmt --check` 与 `cargo clippy --all-targets --all-features -- -D warnings` 均干净。
`pnpm check:quick` 与前端用例交给主会话（前端半在另一分支上并行）。

**argv 组合顺序（唯一落点 `execution::plan_member_spawn`）**

```text
args = resume 片段 ++ mcp_argv(渲染后) ++ prompt_argv(渲染后) ++ bypass_args
启动行 = [program] ++ args          # app::team_executor::launch_argv 只剩拼程序名
```

`resume = None` 时逐字节等于旧输出（旁路开关仍在 preamble 之后，位置未变）。

**偏差（都以「一条事实一个主人」为准）**

- **A：没有 `ResumeArgv`，没有 `suffix`**。`AgentSessionAdapter::resume_command` 原本就返回
  「紧跟 program 的参数片段」（claude/codebuddy/grok `--resume <id>`、codex `["resume", id]`
  子命令、pi/opencode `--session <id>`、omp `--resume=<id>`、reasonix `--dir <p> --resume=<id>`；
  gemini/qoder `None`）。新增一个带 `prefix`/`suffix` 的类型只会多出一个**恒为空**的字段
  （红线 14），所以只加了查表入口 `conversation::adapters::resume_argv_for`（`registry` 是
  私有模块，故在 `adapters` 层 re-export）。位置只由 `plan_member_spawn` 表达。
- **B：`team_resume` 收可选 `member_id`**（`None` = 整队）。成员级恢复与整队恢复是同一件事的
  两个范围：拆成两个命令会让「幂等 / 拒绝理由 / 报告形状」各写两遍，且前端的「单个恢复」
  会变成第二个载荷契约。
- **C：`bypass_args` 从 `app::team_executor::launch_argv` 移入 `plan_member_spawn`**。
  组合根原先自己追加旁路开关 ⇒ argv 顺序有两个所有者，而 resume 片段必须在**最前面**、
  旁路必须在**最后面**。移动后 `launch_argv = [program] ++ plan.args`，顺序只有一处。
- **D：`resume_team` 收 `&Arc<TeamManager>`（不是 `&TeamManager`）**。两次写库
  （`mark_member_resumed` / `record_team_resume`）走 `run_blocking_result` 进阻塞池
  （红线 3：管理器写路径是同步 SQLite，而本函数在 async 上下文里）；`spawn_blocking` 的
  闭包要求 `'static`。读路径（`team` / `members_of`）只读内存镜像，仍留在原线程。
- **E：`no_endpoint()` 文案去掉「create a team」**。恢复也用它（缺的是同一对端口：
  `credentials` + `executor`），原文案会让排查者以为恢复走的是另一条故障路径。

**新增测试（26 条）**

- `registry`：`the_resume_fragment_of_every_admissible_cli_is_the_smoke_tested_one`（覆盖
  `ADMISSIONS` 全表的集合台账；codex 位置在这里钉死）/ `a_resume_fragment_never_contains_the_program_name` /
  `an_unknown_agent_id_has_no_resume_fragment`。
- `execution`：`planning_a_resumed_member_puts_the_fragment_right_after_the_program` /
  `planning_a_fresh_member_is_byte_identical_to_before` /
  `the_only_argv_difference_between_fresh_and_resumed_is_the_fragment`。
- `resume`（13）：`resuming_a_team_restarts_every_offline_member_with_its_native_id` ·
  `a_member_without_a_native_id_is_cold_and_not_started` ·
  `a_cli_without_a_resume_form_is_cold_and_not_started` · `a_live_member_is_skipped` ·
  `resuming_twice_is_idempotent` · `a_sealed_team_is_refused` · `a_closing_team_is_refused` ·
  `a_sealed_member_is_never_resumed` · `one_failing_member_does_not_stop_the_others` ·
  `resuming_one_member_leaves_the_others_alone` ·
  `a_resumed_member_goes_back_to_spawned_and_is_audited` ·
  `resuming_an_unknown_team_or_member_is_not_found` · `the_report_uses_camel_case_wire_keys`。
- `manager`：`resuming_moves_an_offline_member_back_to_spawned` /
  `marking_a_running_member_resumed_is_a_no_op` / `resume_never_clears_the_seal` /
  `members_of_returns_one_team_sorted_by_id`。
- `view`：`a_member_whose_cli_cannot_resume_is_not_resumable` /
  `a_member_without_a_native_id_is_not_resumable` / `a_default_fixture_member_is_resumable`。
- 既有两条**线上键集**判据同步加 `resumable`（`mcp::dispatch::team_status_reports_roster_and_board_summary`、
  `mcp::server::status_payload_carries_no_transcript`）：花名册载荷多了一列，前端镜像要跟着改。

**Red 观测（两次真实失败）**

1. `cargo test --lib conversation::adapters::registry` → `error[E0432]: unresolved import
   super::resume_argv_for`（先写台账测试）。
2. `cargo test --lib agent::team::resume`（实现体用「返回空报告」顶替）→
   `test result: FAILED. 4 passed; 9 failed`（13 条里 9 条红：全部与「真的起进程 / 分桶」有关；
   4 条过的是拒绝与 NotFound 分支，它们在循环之前返回）。

**变异验证（三条，均确认变红后还原）**

1. 把 `cold{UnsupportedCli}` 分支改成「`unwrap_or_default()` 后照常起进程」⇒
   `a_cli_without_a_resume_form_is_cold_and_not_started` 红
   （`left: []` vs `right: [ColdMember { … UnsupportedCli }]`）。
2. 把 codex 的 `resume_command` 改成 `None` ⇒ `the_resume_fragment_of_every_admissible_cli_…` 红
   （`left: None` vs `right: Some(["resume","s1"])`）。
3. 把片段改回「追加在末尾」（2026-11-11 之前的错误形态）⇒
   `planning_a_resumed_member_puts_the_fragment_right_after_the_program` 红。

**有意留下**

- 前端 S2.3（`memberTerminal.ts` 第三态、`team_resume` 的两个入口）不在本次范围（另一分支并行）。
- `team_resume` 的**命令级** `team_surface` 预检没有单测（需要真实的 `AppStateWrapper`）：
  与 `start_team_session` 的同类预检一样靠集成 / 手测，不要把它当成「已覆盖」。
- 进程离线时的「主动通知面板」仍缺一条路径（`MemberSignal::Exited` 的生产者）—— 恢复后
  花名册靠 `live_sessions` 查询即可正确，但面板不会自己知道「它刚死了」（已知下一步）。

#### S2 实施记录（前端半 + 收尾，2026-11-11 完成）

验收数字：`cargo test --lib` **3268 passed / 0 failed / 11 ignored**（后端半 3267 + 收尾 1）；
`npx vitest run` **7532 passed / 813 files**；`pnpm check:quick` **29/29 护栏通过**。
（全量前端那一次有一个与本任务无关的 flake：`PdfFileView` 的「Fit width」在 cargo 编译并行时
因 jsdom 布局时序变红，单跑该文件 10/10 绿，复跑全量前已确认。）

**五态 UI（`openTerminalAction` 是唯一判据）**

| `session.live` | `resumable` | `agentSessionId` | `sealed` | kind | 文案 |
| --- | --- | --- | --- | --- | --- |
| ✅ | — | — | — | `live` | 打开会话 |
| ❌ | ✅ | 有 | ❌ | `resume` | 恢复会话 |
| ❌ | — | 有 | — | `archive` | 查看记录 |
| ❌ | — | 无 | ❌ | `live`（禁用） | 暂无会话 |
| ❌ | — | 无 | ✅ | `live`（禁用） | 已关闭 |

`resumable && !sealed` 才给「恢复」：能力（CLI 有没有续接形态）与用户意图（封没封存）
是两个维度，后端在 `resume_team` 里也各判一次（前端置灰只是 UI，命令是行为）。

**偏差（前端半与收尾）**

- **F：`mark_member_resumed` 把 `Stalled` 与终态同侧**。`Stalled` 不是终态（它还能被信号改写）
  但它与终态一样是**针对一个已消失进程**的活性裁决 —— 恢复起的是新进程，留着旧裁决会让
  花名册一直显示「停滞」。判据写成穷尽 `match`（`is_reporting_member_state`：
  `spawned|running|awaiting|idle` 才是运行态），新增 `MemberState` 变体时必须在这里表态。
  反证：把它退回「非终态即运行态」⇒ `resuming_a_stalled_member_clears_the_stall` 红。
- **G：`resumable` 落在 `MemberStatusView` 上 ⇒ MCP `team_status` 也会带这一列**。诚实记账：
  它是**派生**字段（有原生 id ∧ 该 CLI 有续接形态），不是执行参数；模型读它的用途是
  「这个成员还会不会回来」，与它在 `team_send` 上刚拿到的 `target_offline` 冲突解释同一件事。
  替代方案（在快照上再挂一张 `resumableAgents` 能力表）会让抽屉 / 花名册各查一次，
  且成员级的能力只能用 `agentId` 反查 —— 那是把「一名成员能不能回来」拆成两个事实。
- **H：`TeamPanel.tsx` 触到 300 行红线 ⇒ 抽两个文件**（行为零漂移）：
  `hooks/useTeamResumePanel.ts`（面板级在飞闸门 + 两个入口收窄成 `resumeTeam` / `resumeMember`，
  `teamId` 只绑定一次 —— 三个入口各拼一次就会各自拼错一次）、
  `components/TeamPanelErrors.tsx`（关闭 / 恢复两条团队级错误的可见性判据：入口横跨两个视图，
  所以错误必须贴顶栏；删除错误仍贴列表行）。
- **I：前端的「有没有可恢复成员」也走 `openTerminalAction`**（`hasResumableMember`）：
  不另写 `!live && resumable`，否则头部的「恢复团队」与成员行的文案会各自漂移。

**收尾期发现并修掉的一个既有缺陷**：`TeamView` 从未把 `onOpenHistory` 传给
`MemberDetailDrawer` ⇒ 抽屉里的「查看记录」（S1 起）是**静默空操作**。已补，并用
「离线 + 不可恢复 ⇒ 查看记录」那条用例钉住（删掉该 prop 传递 ⇒ 红）。

---

## S3 — 历史按身份归属

### S3.1 团队记录工作区身份

- [ ] `team` 行加 `workspace_worktree`（v22 已加列）；`start_team_session` 增参
      （前端传 `activeWorkspace`）；`TeamLaunchPanel` 不再只传 `projectPath`。
- [ ] `team_executor` 的 `TerminalRegistration.workspace` 改用团队行的 workspace_ref
      （修掉「注册丢 worktree 维度」这条偏差）。
- [ ] Red：建队后 `session_cursors.workspace_key` 与团队行一致。

### S3.2 scope 从路径到身份

- [ ] `ConversationListScope::Project { path }` → `Project { project_id, paths }`
      （`paths` 由项目/工作树域解析后传入；conversation 域不拼接）。
- [ ] 项目域提供「项目全部工作区根」的读接口（worktree 枚举既有能力：
      `git/operations/worktree.rs`），失败时降级为「项目根 + 团队行记录的 worktree」。
- [ ] `scope.rs` 的目录编码函数保持纯函数，输入变 `&[PathBuf]`。
- [ ] Red（红线 13：夹具路径由 `tempdir()` 推导）：项目根 + 外部工作树两组路径的会话
      都被列出；未注册的路径仍然不进（不得变成"什么都收"）。

### S3.3 前端

- [ ] `ConversationsPanelWrapper` 传 `projectId + workspace`，不再 `worktreePath ?? project.path`。
- [ ] 侧栏分组看 `workspaceKey`（后端已修注册，无需前端改判据）。
- [ ] Red：History 在两个工作区之间切换时，会话集合按项目聚合、侧栏按工作区分组。

### S3.4 阶段门

```bash
cargo test --lib conversation::scope
cargo test --lib conversation::manager
pnpm vitest run src/features/conversation src/features/agent-team
pnpm check:quick
```

- Review gate（红线 12）：`grep -rn "starts_with" src-tauri/src/conversation/ | grep -v test`
  必须只剩「已注册根集合上的匹配」，不再有「从路径反推项目」的新代码。
- Review gate：`grep -rn "worktreePath ??" src/` 结果为空。

---

## 收尾（三阶段都完成后）

- [ ] spec 更新：
  - `backend/team-domain.md`：状态语义（open/closing/sealed、offline）、`SessionOwner`、
    `team_resume`、boot 归位、删列与其代价。
  - `backend/conversation-*.md` / `frontend/*`：scope 按身份的契约、
    「会话身份 vs 进程资源」这条不变量写进对应 spec。
  - `frontend/quality-guidelines.md`（若涉及四态判据的落点纪律则补一句）。
- [ ] release note 草稿：v22 删列、旧成员历史入口的替代路径、`team_send` 行为变更。
- [ ] 全量 `pnpm check` 由 push/CI 兜底（本地只在排查差异时跑）。
- [ ] `python3 ./.trellis/scripts/add_session.py` 记录三段会话。

## 已知的下一步（不在本任务内）

- `MemberSignal::Exited` 的生产者（PTY 退出 → 团队域）：S1 之后"离线"可由 query 推导，
  但**主动**通知面板仍需一条路径；等 S2 的恢复入口被真实使用后再定形态。
- 冷缓存 transcript 定位（`session_file_path` 是 cache-only，spec §9a.5 声称的 on-demand
  rescan 并不存在）：S3 会暴露它，单独立项。
