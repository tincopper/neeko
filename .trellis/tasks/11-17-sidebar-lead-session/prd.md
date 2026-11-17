# 侧栏展示队长会话与团队入口

> 父任务：`10-30-multi-agent-orchestration`。前置：`11-17-team-member-session-lifecycle`（成员会话不落恢复行 + 侧栏删除判负）。

## Goal

左侧会话列表（Projects 面板的 `项目 → 单元 → 会话` 树）今天把**团队成员的会话**和用户自己的会话平铺在一起，
两者没有任何区别标记。结果是：**没有任何入口能从侧栏回到某个团队**，而唯一"看着像入口"的那些行
（成员的会话行）既不知道属于谁、也不能代表团队（进程一死就消失）。

本任务让侧栏支持**团队维度**：

1. 每个团队在它所属的**单元**下有一条**团队行**（身份 = 团队，而不是某条 PTY）：显示队名 + 团队状态 +
   规模/任务进度，点击进入**队长会话**，行尾固定入口是**看板**（＝"方便查看任务的入口"）。
2. 成员会话不再混进会话子列表（它们归花名册管，那里才有六态 / 租约 / 待批队列）。

## 现状（可指到文件的事实）

| # | 事实 | 位置 |
| --- | --- | --- |
| 1 | 成员 PTY 与用户会话共用同一张 live_sessions 注册表，归属在起进程时写入 | `src-tauri/src/app/team_executor.rs:234-247` |
| 2 | 但 `SessionView`（wire）**不含归属** ⇒ 前端无法区分成员会话与自己的会话，只能全部平铺 | `src-tauri/src/live_sessions/view.rs:22`、`src/shared/types/liveSessions.ts` |
| 3 | 侧栏"团队显示什么"的唯一来源是会话快照（`sessionsByUnit` / `isListedSession`），它只认识 `workspaceKey` | `src/shared/selectors/liveSessionSelectors.ts:86,126` |
| 4 | 团队清单 `team_list` 已存在且**行数有界**（`MAX_LISTED_TEAMS = 50`，`truncated` 标记），带 `state` / `memberCount` / `taskOpen` / `taskDone`，`project_id` 参数可选（`None` = 全部） | `src-tauri/src/agent/team/view.rs:478-517`、`src-tauri/src/agent/team/commands.rs:567` |
| 5 | 但 `TeamSummary` **缺 `projectId` 与 `workspaceWorktree`** ⇒ 前端无法把团队挂到正确的单元（只能靠路径前缀猜，红线 12 禁止） | `src/features/agent-team/view.rs:489-512`、`src/shared/types/team.ts:567` |
| 6 | "打开成员会话"的判据已经存在且只有一份（五态：活 → 接管 PTY / 可续接 → 恢复 / 封存 → 历史 / 无会话 → 置灰 + 可见理由） | `src/features/agent-team/utils/memberTerminal.ts` |
| 7 | 团队面板已经能把成员会话接进终端 tab（`openExistingTerminalTab`），按**团队自己的** `projectId` 落键 | `src/app/dock/wrappers/TeamPanelWrapper.tsx` |

## Requirements

### R1 · 团队行（身份 = 团队）

- 每个团队在 `(projectId, workspaceWorktree)` 合成的单元下渲染**一行**；团队行与会话子列表同处该单元的子项区。
  该单元不存在（项目未打开 / 工作树已删）时**不渲染**（不猜归属，不把团队挂到别处）。
- 行内容：队名（主）+ 团队状态徽标 + `未终结任务/总数`（来自 `TeamSummary`，**不额外拉快照**）。
  **不显示成员数**：`memberCount` 不含队长，而面板头也用它 —— 侧栏再写一次会变成同一个词的两个口径；
  且任务进度比人数更能回答「要不要点进去」。
- 队长会话活着时，行内以次要位置显示**队长会话标题**（"lead 会话"可见性）；不活着时显示「队长未运行」。
- 行不随队长进程消失而消失（这是它与"成员会话行"的根本差别）。

### R2 · 两个动作，各只有一条路径

- **点击行 → 队长会话**：
  - 队长会话活着 ⇒ 接管那个 PTY（`openExistingTerminalTab`，与团队面板「打开会话」**同一个原语**）；
  - 不活 / 封存 / 从未起过 ⇒ **不**续写裸 CLI、也不在侧栏猜"为什么开不了"：把 Team 面板切到该队，
    由花名册的五态判据给出可行动作（恢复团队 / 查看记录）。
  - 侧栏**不**重写 `utils/memberTerminal.ts::openTerminalAction` 的五态判据（它缺 `resumable` / `sealed`
    两列，重算必然造出第二套判据；判据仍是那一份，侧栏只是把"不知道"的情况交回它的宿主）。
- **行尾按钮 → 看板**：`useTeamBoardTab().openBoardTab({ teamId, teamName, projectId, view: 'board' })`
  （去重按 `teamId`，已开则激活）。
- 团队行**没有**改名 / 删除（团队的生命周期在面板里）。

### R3 · 成员会话退出侧栏会话列表

- 归属为团队成员的会话不再出现在会话子列表里（含"某单元最近一条会话"的选择）。
- 前台是某个成员的会话时，**该团队行**呈现「当前」态（侧栏不失去"当前在哪"的提示）。

### R4 · 数据来源不得互为影子副本

- 队名 / 状态 / 规模 / 任务计数**只**来自 `team_list`；队长会话的"活没活"**只**来自 live_sessions 快照。
  两侧都不得在本地缓存对方的变化（红线 17）。
- 归属（`teamId` / `memberId`）是**起进程时**写入的事实，只用于"这条会话属于谁"，不用于展示成员状态。
  "谁是队长"**不**进归属（那是 `team_member.role` 的事实，在 `TeamSummary.leadMemberId` 上读）——
  否则会话层就多了一份可以陈旧的队长身份。

## 明确不做

- 不做第二个团队面板：侧栏不显示成员六态 / 租约 / 待批队列（花名册是唯一落点）。
- 不做成员会话行（只做团队行 + 队长入口）。
- 不改团队面板的信息密度（另一个任务）。
- 不清理历史幽灵行（见前置任务 prd「明确不做」）。

## Acceptance Criteria

- [x] **AC1** 后端 wire：`SessionView` 携带归属（`{ kind: 'teamMember', teamId, memberId } | { kind: 'user' }`），
      Rust ↔ TS 同一 diff 同步；快照用例覆盖"成员会话带归属 / 用户会话为 `user`"。
- [x] **AC2** 后端 wire：`TeamSummary` 增加 `projectId` / `workspaceWorktree`（`null` = 主 checkout）/
      `leadMemberId`（`null` = 该队没有队长行），三列与 `Team` 行同源；`team_list` 用例覆盖工作树团队与无队长行团队。
- [x] **AC3** 单元下渲染团队行；单元 key 由 `(projectId, workspaceWorktree)` **经 `WorkspaceSession.key()`** 铸造
      （禁止在侧栏拼 key）；主 checkout 团队落在项目根行下。
- [x] **AC4** 团队行点击按 `openTerminalAction` 分派：活 → 不新建进程地接管 PTY（有用例断言未调用 `create_terminal_session`）；
      不活 → 打开 Team 面板且不创建终端 tab。
- [x] **AC5** 行尾看板按钮打开 `team-board` tab（同队重复点击激活既有 tab，不新开）。
- [x] **AC6** 成员会话不出现在会话子列表；"某单元最近一条会话"跳过成员会话；
      前台为成员会话时该团队行标「当前」。
- [x] **AC7** 团队行对既有侧栏零回归：无团队时渲染结果与今天一致（快照/测试断言）。
- [x] **AC8** `pnpm check:quick` 通过；`cargo test live_sessions` `cargo test team` 通过。

## Notes

- 三个侧栏变体（本地项目树 / 工作树列表 / WSL·SSH 连接卡）共用 `UnitSessionList` 这一个装配点，
  UI 改动必须只在那一处（否则会出现"本地有团队行、远程没有"的漂移）。
- 团队行在 260px 列宽里要能放下：队名 + 状态 + `N 人` + 任务计数，参考 `11-17-team-panel-density` 的密度契约。

## 实施记录（与原计划的差异，均已落在代码与 spec 里）

| # | 计划 | 实际 | 为什么 |
| --- | --- | --- | --- |
| 1 | `SessionAttribution` 加 `role: MemberRole` | **不加**；改用 `TeamSummary.leadMemberId` 求交 | `live_sessions` 与 `agent::team` 之间是**双向**防火墙（后者只经 `MemberSessionLookup` 端口问会话域），加 `role` 会造出反向边 + 一份会陈旧的队长身份（红线 17） |
| 2 | 团队行显示 `N 人` | **不显示**，只显示 `未终结/总数` | `memberCount` 不含队长，面板头也用它 —— 侧栏再写一次就是同一个词的两个口径，且它对本行的决策价值低于任务进度 |
| 3 | `UnitSessionList` 一处挂载即可 | 还需 **3 个宿主 + `WorktreeRowList` 的 `extraChildCount`** | 子列表原本「有会话才挂载」，而成员会话被过滤后**纯团队单元**（常态）连展开箭头都没有 → 团队行永远没有挂载时机 |
| 4 | 未计划 | **`ProjectsPanel` 首拉清单**（`useTeamListBootstrap`） | 清单原本只在团队面板挂载时拉；侧栏常驻而面板不常驻 → 侧栏永远停在「还没问到」 |
| 5 | 未计划 | **父行让出选中态不看 `hasUserInput`** | 刚接管的队长会话 `hasUserInput` 仍是 `false` → 父行填充 + 团队行 `row-current` **双亮** |

## 已知遗留（不在本任务内）

- **attach 竞态**（`TerminalViewBase.tsx` 的 `attached ?? createSessionVal(...)`）：快照说活着、探针发现已死时，
  仍会按「新建会话」拉起 agent —— 那正是本任务全程在防的「没有团队 MCP / 凭证的裸 CLI」。
  花名册的「打开会话」走同一条路，所以是**既有**边角，不是本任务引入。修法需要一条 attach-only 模式
  （进程不在了就报错/交回团队域，而不是降级成新建），影响面覆盖花名册与侧栏两处，单独立项。
- **侧栏点团队行不切激活项目**：只切该项目的**单元**（与 `useActivateSession` 同一条既有行为）。
  从另一个项目的树里点团队行时，中心视图仍停在原项目 —— 需要 `ProjectActionsContext` 的副作用才能一致。
