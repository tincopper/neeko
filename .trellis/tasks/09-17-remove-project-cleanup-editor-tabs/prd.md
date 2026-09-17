# handleRemoveProject 移除项目时清理 editorStore tab 空间

## Goal

useLocalProjects.ts:161 移除项目仅修 activeTabId，该项目的 editorStore tabs 与 navigateGoal 一并滞留（前史遗留，非导航目标模型引入）。修法：复用 clearProjectTabs（其内已通过 dropNavigateGoalFor 级联清理 goal）。（NavGoalCheck2 发现，2026-09-17）。

## Requirements

- R1 `handleRemoveProject` 移除项目时清理该项目**全部** tab 空间——一个项目可能存在基础 + worktree 多个键空间（`resolveTabKey` 派生），需遍历/前缀匹配覆盖，不得只清基础键
- R2 清理复用 `clearProjectTabs`（其内 `dropNavigateGoalFor` 已级联清 `navigateGoal`），禁止绕开单写 helper 自行改 tabs 结构
- R3 仅在项目确认移除后清理；取消 / 失败路径不触碰 tabs
- R4 清理后 UI 兜底落到剩余项目/空态（复用 `clearProjectTabs` 既有兜底机制，不新写）

## Acceptance Criteria

- [x] 移除含已开 tab 的项目 → `editorStore.tabs` 无该项目任何键空间残留，`navigateGoal` 无该项目残留
- [x] 移除无 tab 的项目 → 无副作用
- [x] 其他项目的 tab 与 goal 不受影响
- [x] 新增用例：有 tab / 无 tab / worktree 变体三种移除场景；门禁 `pnpm type-check` / `pnpm test:run` / `pnpm lint` / `npx eslint src/` 全绿

## Notes

- 前史遗留（NavGoalCheck2 发现，2026-09-17）；O1 契约（closeTab/clearProjectTabs）已覆盖移除动作本身，本任务是补**消费侧调用**
- 现状：`useLocalProjects.ts:161` 仅修 `activeTabId`
- 多键空间遍历的实现位置倾向调用侧（useLocalProjects），store 不加新 API；键空间前缀格式以 `resolveTabKey` 实现为准
