# Design — 侧栏团队入口

## 1. 核心裁决：团队行是 **team-derived**，不是 lead-session-derived

| 方案 | 身份 | 队长进程死了 / 重启后 | 能放什么信息 | 判定 |
| --- | --- | --- | --- | --- |
| A · 团队行（选定） | 团队（`team_list` 的一行） | **仍在** | 队名、团队状态、`N 人`、未终结/总任务数 | ✅ |
| B · 队长会话行 | 某条 PTY | **消失**（进程没了就没有行） | 会话标题、状态点 | ❌ |
| C · 队长会话行 + 兜底团队行 | 两个身份 | 要处理"有会话时重复两行" | 两份 | ❌ KISS |

B 被否掉的理由正是用户诉求的反面：**最需要入口的时候（队长进程不在、刚重启）它刚好没有行**。
C 让同一个团队在同一个单元下出现两行，或者需要"有会话时抑制团队行"的联动规则 —— 两条身份判据必然漂移。

A 的代价是团队行不知道"队长会话此刻是哪条"，需要一次归属 join —— 见 §5，join 用的是**已经在内存里**的
会话快照，零额外 IPC。

## 2. Wire 契约变更（两处，都是**加字段**，无破坏性）

### 2.1 `SessionView.attribution`

用途**只有**一个：判断"这条会话属于团队成员"（→ 从侧栏会话列表过滤掉，并给团队行标"当前"）。
不用于展示成员状态（那是花名册的事）。

```
attribution: { kind: 'teamMember', teamId, memberId, role: 'lead' | 'worker' }
           | { kind: 'user' }        // 或直接 null；二选一，见下
```

- Rust：`entry::SessionAttribution` 加 `Serialize`（`#[serde(tag = "kind", rename_all = "camelCase")]`，
  variant `User` → `{"kind":"user"}`、`TeamMember { .. }` → `{"kind":"teamMember", teamId, memberId, role}`）。
  `role` 需要从 entry 带上 —— `SessionAttribution::TeamMember` 目前只有 `team_id` / `member_id`，
  **加 `role: MemberRole`**（写入点是 `team_executor.rs` 起进程那一刻，`member.role` 就在手上）。
- **`role` 为什么可以进归属**：它没有变更路径（`grep` 结果：`team_member.role` 无任何 UPDATE），
  与 `agent_id` 同属**创建期事实**。若将来出现"转让队长"，必须删掉这个字段改走花名册读接口 ——
  这条写进 spec，不然下一个人会把它当缓存用。
- TS 镜像在 `shared/types/liveSessions.ts`，同 diff 改。

**不做**：把 `role` 之外的成员事实（name / state / lease）塞进归属 —— 那是花名册的影子副本（红线 17）。

### 2.2 `TeamSummary.projectId` + `TeamSummary.workspaceWorktree`

团队行要挂到单元下，而单元身份由 `WorkspaceSession { projectId, worktreePath }` 铸造（红线 12：
禁止拼路径前缀猜归属）。`TeamSummary` 今天只有 `projectPath`，无法回答"哪个项目 / 哪个工作树"。

- 两列都已在 `Team` 行上（`project_id` v16、`workspace_worktree` v23），`list_teams_scoped` 只是没投影。
- `workspaceWorktree: string | null`（`null` = 主 checkout，与 `Team` 同语义）。
- **旧行**（v16 前空 `project_id`）：`projectId` 为空串 ⇒ 前端**不渲染**团队行（挂到哪都是猜）。
  与 `useTeamList` 现有的"空 project_id 行被后端排除"口径一致 —— 若 `team_list(None)` 仍返回它们，
  侧栏按空串过滤。

## 3. 装配点：只在 `UnitSessionList` 一处

三个侧栏变体都经由 `UnitSessionList`（`WorktreeList` / `ConnectionWorktreeList` / `ProjectGitSection` /
`ConnectionProjectCard` 都调它），所以渲染点只有一处，不会出现"本地有、远程没有"的漂移。

依赖方向：`live-sessions → agent-team` 的**门面**（`@/features/agent-team` 导出 `UnitTeamEntries` 组件）。
- 方向合法：`agent-team` 不依赖 `live-sessions`（已确认），无环。
- `live-sessions` 已有对 `agent` / `terminal` / `editor` / `agent-chat` 的同类依赖，不是新类别。
- 备选（每个调用点注入 `renderUnitTeams` prop）被否：4 处机械重复，且新增侧栏变体时容易漏。

组件归属：团队行本身（视觉 / 行为）全部在 `features/agent-team/components/UnitTeamEntries.tsx`，
`live-sessions` 只负责"在会话子列表旁边放一个它"。

## 4. 读路径：团队清单进 store，面板与侧栏共用一份

`useTeamList` 今天是**面板局部**的 `useState`。侧栏是常驻的，若各拉一份 = 同一个资源两套轮询。
抽出 `features/agent-team/store/teamListStore.ts`（zustand）：

| 关注点 | 设计 |
| --- | --- |
| 拉取 | `refresh()`：`fetchTeamList(null)`（全部项目 —— 侧栏列的是所有项目，不能用"激活项目"顶替）|
| 刷新触发 | 复用**唯一**团队脉冲监听 `ensureTeamPulseListener`：同一个 listener 再 poke 一次列表 store；去重代数各自持有 |
| 三态语义 | 与原 `useTeamList` 完全一致（未问到 / 失败且从未成功 / 空清单），`useTeamList` 变成它的薄 selector，面板测试不变 |
| 失败 | 不清空上一次成功结果（同 `teamStore` 纪律）|
| 成本 | 载荷有界（≤ 50 行 + `truncated`），低于红线 4 两个数量级；刷新由脉冲驱动，不轮询 |

侧栏只读 `teams`，**不**读 `truncated` 的语义（>50 个团队时侧栏会少显示，这是可接受的有界退化；
`truncated` 不另做 UI —— 面板是"看全部团队"的地方）。

## 5. 行为分派：一条判据 + 一个不猜的兜底

| 状态 | 点击团队行 | 依据 |
| --- | --- | --- |
| 会话快照里存在该队的**活队长会话**（归属 `teamMember{teamId, role:lead}` 且 `state` 非终止）| `openExistingTerminalTab(team.projectId, sessionId, title, agentId)` —— 接管 PTY，**不**新建进程 | 与花名册"打开会话"**同一个原语** |
| 否则 | `teamStore.openTeam(teamId)` + `dockStore.activateView(panelView('team'))`；**不**创建任何终端 tab | 侧栏不知道"为什么开不了"（未起过 / 已退出 / 已封存 / 可续接），这些事实只在花名册行上 |

这条边界是刻意的：侧栏**不**重写 `memberTerminal.openTerminalAction` 的五态判据（缺 `resumable` / `sealed`
两列，重算必然造出第二套判据，而错分的后果是"以为在恢复、其实起了个没有团队 MCP 的裸 CLI"）。
侧栏只回答"有没有活会话"，其余一律交给面板。

行内元信息据此显示：有活队长 ⇒ 副文案 = 队长会话标题；否则 = 「队长未运行」。

## 6. 过滤成员会话与"当前"态

- 新增 `isTeamMemberSession(session)` = `session.attribution?.kind === 'teamMember'`。
- **不改** `isListedSession` 的语义（它是"有没有真标题 / 用户用过"，tab 标题与 `getRecentSessionOfKind`
  之外的消费点也依赖它）。改动落在两个消费点：
  - `sessionsByUnit`（侧栏子列表）跳过成员会话；
  - `getRecentSessionOfKind`（点种类图标"接回上一次"）跳过成员会话 —— 成员会话不归用户管。
- `unitsWithListedActiveSession`（父行让出选中底的判据）**保持**读 `isListedSession`，
  但注释要改：成员会话不会渲染子行，父行让出后由**团队行**承担"当前"提示。新增派生：
  `foregroundTeamId = 前台 refs 对应的会话里 attribution.kind==='teamMember' ? teamId : null`，
  团队行 `teamId === foregroundTeamId` 时加 `row-current`。

## 7. 视觉与密度（260px 列宽）

单行、两段式（与会话行同一档字号，比单元行小一档）：

```
[Users] 队名 · open              3 人 · 2/5   [看板]
        队长 · <会话标题 或 「队长未运行」>
```

- 队名截断优先；`N 人` 与任务计数是 mono + `tabular-nums`（数字行对齐，同 `SessionListRow` 的相对时间）。
- 看板按钮常驻（不做 hover 覆盖）——它是本任务的核心入口，藏起来就白做了；行点击区域让开右侧按钮。
- 状态徽标复用 `TeamStateBadge`（不新造第三套状态词表）。

## 8. 风险 / 回滚

- **两个可独立 revert 的切片**：①wire（§2，加字段不改行为）；②UI（§3-§7）。
- 回归面：`useTeamList` 被改为 store selector（面板 5 处测试）、`sessionsByUnit` 的过滤（侧栏测试）、
  `SessionView` 快照用例。每处都要么补断言、要么证明零变化。
- 护栏相关：不新增事件名（红线 5）；不拼单元 key（`check_workspace_identity`）；
  新 store 只存读结果，不存"我请求过谁"（`check_frontend_resource_mirror` / 红线 17）。

## 9. 测试策略

| 层 | 用例 |
| --- | --- |
| Rust | `view_serializes_attribution`（两种归属形状）；`team_list` 投影带 `projectId` / `workspaceWorktree`（含主 checkout 的 `null`） |
| selector | `sessionsByUnit` 跳过成员会话；`getRecentSessionOfKind` 跳过；`unitsWithListedActiveSession` 行为不变 |
| 组件 | `UnitTeamEntries`：有活队长 → 副文案是会话标题、点击走 `openExistingTerminalTab`；无活队长 → 副文案「队长未运行」、点击把面板切到该队（断言**未**创建终端 tab）；看板按钮 → `openBoardTab`（同队幂等） |
| 装配 | `UnitSessionList` 在无团队时渲染结果与今天一致（快照式断言）|
