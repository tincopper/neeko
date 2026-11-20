/**
 * 团队域**前端自有**的类型（不是 wire 契约 —— 那些住 `shared/types/team.ts`）。
 *
 * 放这里的判据：它被本 feature 的**多个层**共用（hooks / components / utils），而放回任何
 * 一层都会让另一层反向依赖它（`utils → hooks` 是我们踩过的那种倒置：方向反了，且会让
 * 「草稿多一个字段 = 工具函数该处理它」这种误读成立）。
 */

/**
 * 建队面板**当前提供**的工作区选项（v1 只做两个）。
 *
 * 故意比后端的 `Workspace` 窄：后端还有 `{ worktree: { path } }`，而本面板没有路径选择器
 * （下一轮接）。用一个更窄的本地联合来表达「UI 现在只能选这两个」—— 直接用后端宽类型会
 * 让 `Record<Workspace, …>` 的映射表编译不过是必然的，而把它写成 `Partial` 又会把
 * 「UI 没提供」变成运行期缺键。
 */
export type LaunchWorkspace = 'shared' | 'read_only';
