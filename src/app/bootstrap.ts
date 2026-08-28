import { preloadRendererAddons } from '@/shared/utils/terminal';

import { registerGlobalErrorHandlers } from './registerGlobalErrorHandlers';

/**
 * 应用启动期一次性初始化（renderer-plan 设计的不变式收口）。
 *
 * 设计约束（见 `shared/utils/terminal.ts` 顶部 RendererPlan 不变式）：
 * - `preloadRendererAddons` 必须发生在「不存在任何终端」的时机（启动期），
 *   才能让运行期 `applyRenderer` 的 `await import` 命中模块缓存 → 微任务原子、
 *   dispose 宏任务无法插入竞态窗口。散落在 `main.tsx` 顶层是可行的，但随着
 *   启动期动作增多（错误兜底、主题预热、renderer 预热等）会让入口文件退化
 *   为隐式初始化清单 —— 职责不清、难以单测与复用。
 * - 抽为 `bootstrap()` 后，`main.tsx` 只负责「挂载 React 树」这一件事；
 *   所有副作用初始化在此收口，后续新增启动动作只需在此增量，无需触碰入口。
 */
export function bootstrap(): void {
  registerGlobalErrorHandlers();
  preloadRendererAddons();
}
