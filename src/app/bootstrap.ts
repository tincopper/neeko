import { installGlobalOwners } from './bootstrap/globalOwners';

/**
 * 应用启动期一次性初始化（renderer-plan 设计的不变式收口）。
 *
 * 为什么抽成函数：
 * - 启动期动作若直接铺在 `main.tsx` 里，入口文件会退化为隐式初始化清单 ——
 *   职责不清、难以单测与复用。
 * - 抽为 `bootstrap()` 后，`main.tsx` 只负责「挂载 React 树」这一件事；
 *   所有副作用初始化在 `bootstrap/globalOwners.ts` 的唯一清单里收口。
 * - `applyThemeHintBeforeRender` 必须在 `createRoot().render()` 之前，否则 CSS 首帧
 *   会先用 `DEFAULT_CONFIG.theme` 兜底、加载完再翻转（整窗闪黑）。
 *
 * 不返回 cleanup：本模块没有 HMR accept 边界（整图无 `import.meta.hot.accept`），
 * 任何改动都会冒泡成整页 reload —— 清理钩子在这里永远不会被执行。
 * 需要清理能力的调用方（单测）直接用 `installGlobalOwners()` 的返回值。
 */
export function bootstrap(): void {
  installGlobalOwners();
}
