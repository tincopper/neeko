# Design — 容器模型的形状与它必须付的代价

## 1. 为什么层级换了，而不是加一层

「团队挂在单元下」这个位置不是随手放的：它把团队当成**占用者**（和会话并列，谁占着这棵树）。
容器模型把团队当成**归属物**（谁在跑、跑在哪儿）。差别在成员空间：

| 成员的 worktree | 单元锚定（今天） | 容器（本任务） |
| --- | --- | --- |
| 没有（共享团队树） | ✅ 正确 | ✅ 正确 |
| 每个成员各自的树 | ❌ 团队行只能选一棵挂，其余成员的会话无处安放 | ✅ 团队跨单元，成员各自带单元 |

所以本任务不是「顺手改层级」，而是**为成员空间把位置腾出来**。容器对今天（共享树）也正确，
所以可以先落地、后接成员空间。

## 2. 三级语义（改后）

| 级 | 语义 | 身份 | 子项 |
| --- | --- | --- | --- |
| 1 | 项目 | `projectId` | 单元行、团队行 |
| 2 | **地点**（单元） / **容器**（团队） | `workspaceKey` / `teamId` | 我的会话 / 成员 |
| 3 | 会话 / 成员 | `(kind, sessionId)` / `memberId` | — |

两种二级行的**身份不同**，所以团队行必须有独立标记（`⟦team⟧` + 团队状态徽标），否则用户会把它
当成第三棵树。它们的可点击语义也不同：单元行 = 「在这棵树里开终端」；团队行 = 「看那个队长在干什么」。

## 3. 成员会话的归属：与单元无关的那一次求交

```
team.teamId + member.memberId  ←──  attribution(teamMember){teamId, memberId}  ←── live 快照
```

两侧都已经是事实，不需要新 wire：
- 左侧来自花名册（`TeamSnapshot.members[].memberId`）与 `team_list`（`TeamSummary.teamId`）；
- 右侧来自 `SessionView.attribution`（上一轮已上 wire）。

**成员名只来自花名册**。会话里有 `memberId`（`w1@tm_1`），从它拆名字是第二套身份解析（红线 12 同族），
而且一旦成员改名就与花名册漂移。所以折叠态**不显示成员**，只显示队长会话标题（那个来自会话标题，
不是成员名）。

## 4. 花名册：按队缓存，不复用 `teamStore`

新增 `agent-team/store/teamRosterStore.ts`：

| 关注点 | 设计 |
| --- | --- |
| 形状 | `rosters: Record<teamId, { members, memberCount, loading, error }>`，`ensure(teamId)` 幂等 |
| 读法 | `fetchTeamSnapshot(teamId)`（已有的读接口，载荷有界：花名册 + ≤200 任务列），只取 `members` |
| 失效 | 既有团队脉冲 → 清空所有已缓存的 roster（一次脉冲一组写，全量自愈） |
| 为什么不用 `teamStore` | `teamStore.snapshot` 是「面板当前打开的队」；侧栏展开 A 队若写它，面板会被切到 A（AC4） |
| 红线 17 判据 | 它缓存的是**后端读接口的响应**，不是「我请求过谁 / 我展开了谁」；展开态是组件本地 state |

**为什么可以直接用 `team_snapshot`** 而不是新增 `team_roster` 命令：`team_list` 的回答是「这台机器上有
哪些队」，`team_snapshot` 的回答是「这一个队长什么样」。新增一条只返回成员的命令 = 同一份数据的
第三个读面，而载荷已经是有界的。代价是展开时多搬 ≤200 条任务卡片 —— 若实测有压力，再加
`team_roster`（届时是删一条旧路径，不是并行两条）。

## 5. 团队的树：标记而不隐藏（对上一轮说法的修正）

上一轮我说「倾向隐藏团队占用的工作树」。设计时发现那会带走**唯一**入口：隐藏后用户无法在这棵树里
开终端、看不到自己在那棵树里的会话、也进不去文件树。而团队行提供的是另一个视角（谁在跑），
不是同一入口的第二个副本。

所以：**不隐藏**，只加 `⟦team⟧` 标记。判据是「团队记的 `(projectId, workspaceWorktree)` 与本行
单元相等」—— 两个字段都来自后端，不做路径前缀比较（红线 12）。

## 6. 团队空间缺失

团队行是容器，它的存在不依赖那棵树还在不在。所以：
- 仍渲染；
- 标注「workspace missing」（判据：`git info` 的 worktree 列表里找不到该路径 —— 只在前端已有数据里比对，
  不新增 IPC）；
- 不影响点击（有活队长就还能接管 —— 进程可能在树被删之前就起来了）。

## 7. 改动面

| 文件 | 改动 |
| --- | --- |
| `agent-team/utils/teamList.ts` | `teamsByUnit` → `teamsOfProject`（按 `projectId` 分组，丢弃空 `projectId` 的旧行） |
| `agent-team/hooks/useTeamsByUnit.ts` | → `useTeamsOfProject()` |
| `agent-team/components/UnitTeamEntries.tsx` | 迁出单元 → 新的项目层容器组件（`ProjectTeamList` + 可展开 + 成员子行） |
| `live-sessions/components/UnitSessionList.tsx` | 移除团队行挂载（回到纯会话列表） |
| `project/components/ProjectGitSection.tsx` | 挂 `<ProjectTeamList>`；单元 `childCount` 回到会话数 |
| `shared/components/WorktreeRowList.tsx` | `extraChildCount` 不再需要（回退到会话数）；若保留则调用方传 0 |
| `connection/components/ConnectionProjectCard.tsx` | 同上（主仓单元 `childCount` 回退） |
| `agent-team/store/teamRosterStore.ts` | 新增（按队懒加载花名册） |

## 8. 测试策略

| 层 | 用例 |
| --- | --- |
| `teamsOfProject` | 按 projectId 分组；空 projectId 丢弃；同项目多队 |
| `teamRosterStore` | 幂等（同队只拉一次）；失败不清空上次成功；脉冲清空缓存 |
| `ProjectTeamList` | 折叠零请求（AC2）；展开一次（AC3）；面板 `teamId` 不变（AC4）；成员行分派（AC5）|
| `UnitSessionList` | 不再渲染团队（AC1 的反面锚点） |
| `ProjectGitSection` | `childCount` = 会话数；无团队时输出与今天一致（AC6） |
| 单元标记 | 团队占用的单元带标记；路径不匹配则不带（AC7） |
