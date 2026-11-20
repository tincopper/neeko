# Implement — 团队容器化（两片，各自可验证）

## Slice A · 数据层（无 UI 变化）

- [ ] **Red** `agent-team/utils/__tests__/teamList.test.ts`（或既有文件）：
      `teamsOfProject` 按 `projectId` 分组、同项目多队、空 `projectId` 丢弃；
      既有 `teamsByUnit` 用例迁到新函数（按单元分组的断言删掉，那是被替代的语义）。
- [ ] **Green** `utils/teamList.ts`：`teamsByUnit` → `teamsOfProject(teams): Map<string, TeamSummary[]>`。
      `useTeamsByUnit` → `useTeamsOfProject`（`hooks/`，门面导出同步）。
- [ ] **Red** `agent-team/store/__tests__/teamRosterStore.test.ts`：`ensure` 幂等（同队一次请求）；
      并发两次 `ensure` 只发一次；失败保留上次成功；`invalidateAll()` 清空；断言它**不碰**
      `useTeamStore`。
- [ ] **Green** 新增 `agent-team/store/teamRosterStore.ts`（`fetchTeamSnapshot` → 只存 `members` /
      `memberCount`），由 `ensureTeamPulseListener` 在既有回调里 `invalidateAll()`（仍是唯一 `listen`）。
- [ ] **Red/Green** selector：`liveSessionSelectors` 新增 `memberSessionsByTeam(sessions)` →
      `Map<teamId, Map<memberId, SessionView>>`（只用归属，不看单元）。**不改** `sessionsByUnit` 的过滤。

## Slice B · 容器 UI

- [ ] **Red** 新组件测试 `agent-team/components/__tests__/ProjectTeamList.test.tsx`：
  - [ ] 折叠态：队名 / 状态徽标 / `未终结/总数` / 副文案；**零** `team_snapshot` invoke（AC2）。
  - [ ] 展开 ⇒ 一次 `team_snapshot`；列出全部成员（含 `session.live === false` 的），折叠再展开不重拉（AC3）。
  - [ ] 展开 ⇒ `useTeamStore.getState().teamId` 不变（AC4）。
  - [ ] 有活会话的成员行点击 ⇒ `onOpenMember(session)`（不新建进程）；无会话的成员行 disabled + 可见理由（AC5）。
  - [ ] 团队空间缺失 ⇒ 行内标注，仍渲染（AC7b）。
- [ ] **Green** 新组件 `ProjectTeamList.tsx`（+ `TeamMemberRows` 子块）：
      - 输入：`projectId`、`teams`（来自 `useTeamsOfProject`）；
      - 团队成员：`useTeamRoster(teamId, expanded)`（展开才 ensure）；
      - 成员会话：`memberSessionsByTeam(useLiveSessionsStore(s => s.sessions))`；
      - 表格外的行结构与既有 `UnitTeamEntries` 一致（复用 `TeamStateBadge`、`leadTitle` 规则）；
      - 组件规模 ≤300 行（`check_component_size`）：必要能拆 `TeamMemberRow`。
- [ ] **Green** 新 hook `live-sessions/hooks/useTeamMemberActions.ts`（或扩展 `useTeamEntryActions`）：
      成员行 ⇒ `activateUnit(WorkspaceSession.fromKeyOrId(session.workspaceKey))` 然后
      `openExistingTerminalTab(...)`（projectId 取**该会话**的单元分量，不是团队的）。
- [ ] **Green** 装配：
      - `ProjectGitSection.tsx` 挂 `<ProjectTeamList projectId=… />`（在 `WorktreeList` 之后或之前，见下），
        并让主仓单元 `childCount` **只数会话**；
      - `ConnectionProjectCard.tsx` 同步（WSL/SSH 主仓单元）；
      - `WorktreeRowList.tsx`：`extraChildCount` 的调用方全部去掉（团队不再进单元），prop 相应移除；
      - `UnitSessionList.tsx`：移除 `<UnitTeamEntries>` 与其 props，回到纯会话列表；
      - `UnitTeamEntries.tsx`：删除（被 `ProjectTeamList` 取代）或改名为容器组件（二选一，别留两份）。
- [ ] 单元行的 `⟦team⟧` 标记：`ProjectGitSection` / `WorktreeRowList`（或它们共用的 `SessionRow`
      `trailing` 槽）读 `useTeamsOfProject()` 判断「本单元是否被某团队占用」，加标记。判据 = 两个字段
      相等，不做路径前缀比较。

## 顺序（二级列表里谁在上）

**地点在上、团队在下**，理由与开放项写在 design：单元行顺序沿用今天（主 checkout → worktrees），
团队块追加在其后，只有存在团队时出现。改顺序是一处 JSX 位置，成本极低，等你看过观感再定。

## 验证

- [ ] `pnpm exec vitest run src/features/agent-team src/features/live-sessions src/features/project src/features/connection src/shared`
- [ ] `pnpm exec tsc --noEmit`
- [ ] `pnpm check:quick`（收尾一次）
- [ ] **不提交**：改动留在工作区，由用户决定。

## 文档同步（Phase 3.3）

- [ ] `.trellis/spec/frontend/state-management.md`：把上一轮「成员会话不进侧栏」的段落改成容器模型
      （团队行在项目层、成员会话挂在团队下、`sessionsByUnit` 仍过滤成员），并写明「为什么必须跨单元」。
- [ ] `.trellis/spec/backend/team-domain.md`：补一句「团队是容器不是地点」——`workspace_worktree` 是
      「跑在哪」，不是「团队拥有哪棵树」；成员空间扩张时侧栏不需要改结构。

## 回滚点

- Slice A 单独可留（新 selector 不被消费时无行为变化）。
- Slice B 的装配点共 4 个文件；回滚 = 把 `<ProjectTeamList>` 撤掉、`<UnitTeamEntries>` 放回
  `UnitSessionList`（该组件在 Slice B 内被删除，回滚时从 git 历史取回）。

---

## Slice C · 第二轮：团队行与单元行同构（用户验收反馈）

目标是一句话：**团队行 = 第二级的第三种行**。做法是复用 `SessionRow`，而不是再维护一套行几何。

- [ ] **Red** `shared/components/__tests__/SessionRow.test.tsx`（或既有文件）：`kind: 'team'`
      ⇒ 行首图标是 `Users`（`data-testid="unit-face"` 里）；既有 local / worktree 两种不受影响。
- [ ] **Green** `shared/components/SessionRow.tsx`：`SessionKind` 加 `'team'`（图标映射一处：
      `local → TerminalIcon` / `worktree → FolderGitIcon` / `team → Users`）。更新文件头注释：
      `kind` **只决定行首图标**（团队行不是执行单元，这一点写清楚，别让下一个人按「执行单元」理解）。
- [ ] **Red** `agent-team/components/__tests__/ProjectTeamList.test.tsx` 改成新形状：
      - 单行：队名 + 状态徽标 + `未终结/总数`；**没有** `⟦team⟧`、**没有** `Lead ·` 副文案；
      - 行内角色：行主体按钮（打开）+ 行尾展开箭头（`aria-expanded`）；
      - 展开 ⇒ 成员行里**队长排第一**并带 `Lead` 标记；其余成员按花名册顺序；
      - 折叠态仍然是**零** `team_snapshot`（AC2 不变）。
- [ ] **Green** `ProjectTeamRow.tsx` 改成薄适配器：渲染一个 `SessionRow kind="team"`，
      `label` = 队名，`labelBadge` = 状态徽标，`trailing`/行尾 = 任务计数，`children` = `TeamMemberRows`
      （`childCount` 传成员数，让「首帧就展开」「成员增长自动展开」与单元行同规则）。
      **删掉**自绘的两行结构与 `toggleExpanded`（展开态交给 `SessionRow` 的既有状态机 —— 一份实现）。
- [ ] **Green** `TeamMemberRows.tsx`：队长排第一 + `Lead` 标记（数据来自 `MemberStatusView.role`）。
      行形状对齐会话子行（缩进由 `SessionRow` 的 children 容器给）。
- [ ] **删除**：`TeamMarker.tsx`、`UnitTeamMarker.tsx`、`SessionRow` 的 `labelBadge` 插槽如果只服务标记
      （现在 `labelBadge` 给状态徽标用，保留）、`WorktreeRowList.unitBadge`、三个宿主的标记接线、
      以及 `agent-team/index.ts` / `live-sessions/index.ts` 的对应导出与相关测试。
- [ ] **Red/Green 隐藏团队占用的工作树**：`WorktreeList` / `ConnectionWorktreeList` 从
      `useTeamUnitKeys()` 取「团队占用的单元 key」，`worktrees.filter(...)` 掉它们。
      用例：被团队占用的工作树不出现在二级列表；非团队占用的不受影响；主仓（`local`）永不被过滤。
- [ ] **注意**：隐藏会让「用户自己在那棵工作树里的会话」在侧栏不可达 —— 这是用户明确要求的取舍，
      在代码注释里写清楚（不是漏项），并把「团队行展开可以看到成员会话」作为补偿说明。
