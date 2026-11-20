# Implement — 侧栏点击 = 切项目 + 切单元

Red → Green → Refactor。

## 1. 类型放宽（R4 的前置）

- [ ] `src/features/project/ProjectContext.tsx`：`onSelectProject: (projectId: ProjectId) => void | Promise<void>`，
      注释写清「实现是 async；调用侧若要『等它结算再落单元』必须能 await」。
- [ ] `npx tsc --noEmit` 确认没有调用点因返回类型放宽而报错（忽略返回值的地方不受影响）。

## 2. `activateUnit`（R1 / R2 / R3 / R4 的唯一落点）

- [ ] **Red** `src/features/live-sessions/utils/__tests__/activateUnit.test.ts`：
      - 项目不同 ⇒ 顺序为 `select:B` 然后 `unit:B/wt`（用数组记序）；
      - 项目相同 ⇒ **不调** select，只落单元；
      - select 返回一个**延迟 resolve 的 Promise** ⇒ 单元在它 resolve **之后**才落
        （这条钉住 R4：反过来会退化，而症状只是「没落到工作树」）；
      - select 返回 `void`（同步实现）⇒ 仍然工作（`Promise.resolve` 兼容两形态）。
- [ ] **Green** 新建 `src/features/live-sessions/utils/activateUnit.ts`：
      ```ts
      export function activateUnit(deps: { selectProject: (id: ProjectId) => void | Promise<void> },
                                   projectId: ProjectId, worktreePath: string | null): Promise<void>
      ```
      纯编排（读 `useProjectStore.getState().activeProjectId` 判断是否要切），单元经
      `WorkspaceSession.of(projectId, worktreePath)` 铸 → `setActiveWorkspace`（红线 12：不在调用侧
      拼 key / 拆路径）。
- [ ] Hook 绑定：`hooks/useActivateUnit.ts`（`useProjectActionsContext()` + 返回绑定好的
      `(unit: WorkspaceSession) => void`，与 `useSessionRowActions` 同一条「hook 只做 React 绑定」纪律）。

## 3. 两个消费者接上

- [ ] `hooks/useActivateSession.ts`：`setActiveWorkspace(...)` → `activateUnit(...)`。
      保留「先切视图再激活 tab」的既有顺序（那是另一条不变量）。
- [ ] `hooks/useTeamEntryActions.ts`：`revealUnit(team)` 改为走同一个 `activateUnit`
      （三个动作共用）；文件头「顺序」段落改成指向 `activateUnit`，不再自己解释一遍。
- [ ] 复核 `openExistingTerminalTab` / `openBoardTab` 的 projectId 仍取**团队自己的**（不是激活项目）。

## 4. 测试

- [ ] **Red** `useActivateSession`：跨项目会话 ⇒ `onSelectProject` 被调 + 最终项目/单元正确；
      同项目会话 ⇒ **零**调用（AC5 的锚点）。
- [ ] **Red** `useTeamEntryActions`：三个动作在跨项目时都「先切项目、后落单元」（顺序数组断言）；
      看板落在**团队自己的单元**的 tab 空间。
- [ ] 修既有受影响用例：`UnitSessionList.test.tsx`、`ProjectsPanel.test.tsx`、任何直接渲染
      侧栏子树的用例包一层 `ProjectActionsProvider`（一个测试 helper，不要每处手写）。

## 5. 验证

- [ ] `pnpm exec vitest run src/features/live-sessions src/features/project src/features/connection src/features/agent-team src/features/editor`
- [ ] `pnpm exec tsc --noEmit`
- [ ] `pnpm check:quick`（收尾一次）

## 6. 文档同步（Phase 3.3）

- [ ] `.trellis/spec/frontend/state-management.md`：在「激活 Workspace」相关段落补一条
      「点侧栏行 = 切项目 + 切单元」，写清两条硬约束（已激活不切、单元在切换结算之后落）。
- [ ] `.trellis/spec/frontend/component-guidelines.md`（若有「侧栏交互」段）指向同一条判据。

## 回滚点

- `activateUnit` 是新增文件；两个消费者各改一行调用。revert 即回到「只切单元」。
- 类型放宽（`void | Promise<void>`）单独可留：它只是把运行期事实写进类型。
