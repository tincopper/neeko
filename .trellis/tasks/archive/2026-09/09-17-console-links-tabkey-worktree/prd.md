# 修复 consoleLinks 任务链接 tabKey 键空间：改用 resolveTabKey 支持 worktree

## Goal

consoleLinks.ts:105 用 projId 直作 tabKey、不走 resolveTabKey——worktree 激活时任务控制台链接把 tab+goal 写进非 worktree 键空间（UI 读不到，tab 可见性缺陷）。修法：openFileInEditor 内改用 resolveTabKey(projId, activeWorktreePath)。注意：会改变 worktree 下任务链接落组行为，需独立验证（NavGoalCheck2 发现，2026-09-17）。

## Requirements

- R1 `openFileInEditor` 的 tabKey 改为 `resolveTabKey(projId, useWorktreeStore.getState().activeWorktreePath)`（对齐 `quick-open/openFile.ts:41`、`runner/navigate.ts:30` 的既有用法）
- R2 全文件排查 tabKey 派生点（两个 `setNavigateGoal` 调用点 ：111/:133 与 tab 查找）统一走同一派生，不得残留双键空间
- R3 worktree 未激活时行为与现状完全一致（`activeWorktreePath` 为空时 `resolveTabKey` 回落基础键空间）
- R4 goal 与 tab 键空间自洽即可——`dropNavigateGoalFor` 按相等匹配清理，无需额外处理

## Acceptance Criteria

- [x] worktree 激活时点击任务控制台链接 → tab 落在 worktree tab 空间并激活，navigateGoal 可兑现（光标到行）
- [x] worktree 未激活时 → 行为与现状一致（回归）
- [x] 新增用例覆盖 worktree 激活/未激活两分支（mock `useWorktreeStore`），现有 consoleLinks 测试全绿
- [x] 门禁：`pnpm type-check` / `pnpm test:run` / `pnpm lint` / `npx eslint src/` 全绿

## Notes

- 改变 worktree 下任务链接落组行为——NavGoalCheck2 明确标记需独立验证，故单列任务
- 键空间事实源：`src/shared/utils/tabKey.ts` 的 `resolveTabKey`
- 发现来源：NavGoalCheck2（2026-09-17）；该文件在导航目标模型变更中仅做过机械改名（`setNavigateGoal`）
