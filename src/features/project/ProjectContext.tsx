/**
 * 项目动作 context 的**门面**（既有导入路径的唯一保留点）。
 *
 * 实现住在 `@/shared/contexts/ProjectActionsContext`：`features/live-sessions` 的侧栏行
 * 点击也要用 `onSelectProject`（`useActivateUnit`），而本 feature 又渲染那个侧栏子树
 * （`ProjectGitSection` / `WorktreeList` 用 `UnitSessionList`）—— 从本门面取 hook 会形成
 * feature 目录级的循环导入。理由与完整契约见实现文件的模块注释。
 *
 * re-export 不是「影子副本」：模块身份仍只有那一个（`vi.mock` 本路径同样生效）。
 */
export * from '@/shared/contexts/ProjectActionsContext';
