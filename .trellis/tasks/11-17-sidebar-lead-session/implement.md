# Implement — 侧栏团队入口

两个可独立验证 / 回滚的切片：**S2（wire）** 先落，**S3（UI）** 在它之上。每步先写失败测试。

## S2 · Wire（不改任何渲染行为）

- [ ] **Red** `src-tauri/src/live_sessions/view.rs` 测试：成员归属的条目序列化出
      `attribution = { kind: "teamMember", teamId, memberId, role: "lead" }`，用户归属为 `{ kind: "user" }`。
- [ ] **Green** `entry::SessionAttribution`：`TeamMember` 加 `role: MemberRole`；`#[derive(Serialize)]`
      （`#[serde(tag = "kind", rename_all = "camelCase")]`）；`SessionView` 加 `attribution` 字段。
      写入点 `app/team_executor.rs:243` 补 `role: member.role`；`cursor.rs` 里 `into_entry` 的
      `SessionAttribution::User` 不变（构造点全量编译即可发现遗漏）。
- [ ] **Red/Green** `agent/team/view.rs`：`TeamSummary` 加 `project_id` + `workspace_worktree`，
      `list_teams_scoped` 投影它们；用例覆盖「主 checkout 团队 `workspaceWorktree = null`」与「工作树团队」。
- [ ] TS 镜像同 diff 改：`src/shared/types/liveSessions.ts`（`SessionAttribution` + `SessionView.attribution`）、
      `src/shared/types/team.ts`（`TeamSummary.projectId` / `workspaceWorktree`）。
- [ ] 前端测试夹具补字段（`tsc` 会点名所有构造点；逐个补真实值，不要 `as any`）。
- [ ] 验证：`cd src-tauri && cargo test live_sessions`、`cargo test team`；`pnpm exec tsc --noEmit`。

## S3 · UI

### S3.1 团队清单进 store（无 UI 变化）

- [ ] **Red** `src/features/agent-team/store/__tests__/teamListStore.test.ts`：首拉 → `loading`；
      成功 → `list`；失败且从未成功 → `error` 保留 `list === null`；成功后失败 → **不清空** `list`；
      陈旧脉冲（`rev <= lastRev`）不触发重拉。
- [ ] **Green** 新建 `store/teamListStore.ts`：`refresh()` 调 `fetchTeamList(null)`，`applyPulse(rev)` 去重；
      `ensureTeamPulseListener` 里在 `teamStore.applyPulse` 之后 poke 一次本 store（**同一个** listener）。
- [ ] `hooks/useTeamList.ts` 改为薄 selector（API 与三态语义不变）；跑既有面板测试确认零回归。

### S3.2 selector：过滤成员会话 + 前台团队

- [ ] **Red** `src/shared/selectors/__tests__/liveSessionSelectors`（或既有文件）：
      `sessionsByUnit` 不含成员会话；`getRecentSessionOfKind` 跳过成员会话；
      `unitsWithListedActiveSession` 行为不变；新增 `foregroundTeamId(refs, sessions)`（无成员会话 ⇒ `null`）。
- [ ] **Green** 新增 `isTeamMemberSession`；在两处消费点过滤；实现 `foregroundTeamId`。
      改 `unitsWithListedActiveSession` 的注释（成员会话不渲染子行，改由团队行提示"当前"）。

### S3.3 团队行组件

- [ ] **Red** `features/agent-team/components/__tests__/UnitTeamEntries.test.tsx`：
      - 无团队 ⇒ 渲染 `null`（AC7 的零变化锚点）；
      - 团队行显示队名 / `N 人` / `未终结/总数`；
      - 有活队长 ⇒ 副文案 = 队长会话标题；点击调 `openExistingTerminalTab`（mock 断言参数 `projectId/terminalId/title/agentId`）且**不**创建新会话；
      - 无活队长 ⇒ 副文案「队长未运行」；点击 `teamStore.openTeam(teamId)` + `dockStore.activateView(panelView('team'))`，且**不**新建终端 tab；
      - 看板按钮 → `openBoardTab({ teamId, teamName, projectId, view:'board' })`；
      - 行上没有改名 / 删除入口。
- [ ] **Green** 新建 `components/UnitTeamEntries.tsx`（草稿：`useTeamList()` + `useSessionsByUnit()`/快照 +
      `useWorkspaceSession` key 铸造 + `TeamStateBadge`）；只在 `agent-team/index.ts` 门面导出该组件。
- [ ] **Red/Green** 装配：`UnitSessionList` 在 `SessionList` 之前渲染 `<UnitTeamEntries workspaceKey={...} />`；
      既有 `UnitSessionList.test.tsx` 补一条"无团队时输出与今天一致"。

### S3.4 验证与收尾

- [ ] `pnpm check:quick`（收尾一次）
- [ ] 手动冒烟（若有 GUI）：建一个 `shared` 团队 → 侧栏项目根行下出现团队行 → 点击接管队长终端 →
      关掉 tab 再点（应重新接管，不是新进程）→ 行尾看板 → 关队后团队行仍在、副文案「队长未运行」。

## 文档同步（Phase 3.3）

- [ ] `.trellis/spec/frontend/state-management.md`：侧栏会话列表的消费口径（成员会话不进列表；团队行是 team-derived）。
- [ ] `.trellis/spec/backend/team-domain.md`：`SessionAttribution.role` 是**创建期事实**（无变更路径）；
      若将来有「转让队长」必须删字段改走花名册读接口。
- [ ] `.trellis/spec/backend/agent-chat-transports.md`：`SessionView.attribution` 的用途边界（只判归属，不展示成员状态）。

## 回滚点

- S2 全部是**加字段**，单独 revert 不影响任何渲染（前端读不到就回落"无归属"，与今天等价）。
- S3.1 / S3.2 / S3.3 各自独立：S3.1 可单独合入（面板行为不变），S3.2 可单独合入（只是过滤），
  S3.3 依赖 S3.1 + S3.2。
