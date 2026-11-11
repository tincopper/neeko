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
- [ ] `conversation::Adapter` 新增 `resume_argv(&self, native_id) -> Option<ResumeArgv>`；
      逐 adapter 实现（claude / codex / pi 支持；gemini / qoder 返回 `None`）。
- [ ] Red：`resume_argv` 逐 CLI 单测（codex 必须是 `["resume", id]` 前缀，不是追加在末尾）
      + `launch_argv` 组合顺序断言（prefix 紧跟 program；suffix 在 preamble 之后）。

### S2.2 重建资源

- [ ] `execution::start_member` 增 `resume: Option<NativeSessionRef>`；
      `plan_member_spawn` 把它交给 `ResumeArgv`（经 `adapter.resume_argv`）；
      **三相位不变**（admit → provision → spawn）。
- [ ] Red：`resume=None` 与 `resume=Some(id)` 的-plan 差异只有 argv 片段 + 审计 detail。
- [ ] `team_resume` 命令 + `TeamResumeReport`（`agent/team/commands.rs`）；
      Red：已 live 跳过（幂等）、`Sealed` 团队拒绝、`cold` 点名、逐成员失败不吞。

### S2.3 前端第三态

- [ ] `memberTerminal.ts` 增加 `kind: 'resume'`；`TeamPanel`/`RosterRow` 接
      `team_resume`（单个成员恢复 + 全队恢复两个入口，文案不同）。
- [ ] Red：四态渲染 + 点击派发（`team_resume` 的 payload 只带 `teamId`，成员级走同一命令后
      过滤结果；不新增第二个命令名）。

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
