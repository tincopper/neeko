/**
 * 全局「恰好一次」owner 的**唯一清单**。
 *
 * 第一性原理：应用级 owner 的生命周期是「整个应用」，不是任何 React 子树。散落在
 * `useEffect` / 注释里的「只挂一次」无法审计、无法机器校验，还会被 StrictMode 双挂载
 * 反复撕开。这里把所有 owner 收成一张声明式清单，安装入口只有 `bootstrap()` 一个。
 *
 * ## 类型即判据
 *
 * - 判别联合让「声明了 `preRender` 却没给 `start`」在**编译期**不可表达 ——
 *   `installGlobalOwners` 不再需要「缺 start 就静默跳过」的分支（静默跳过等于漏装）。
 * - `reactHook` 形态受 React hooks 规则约束（调用顺序必须静态，不能遍历清单调
 *   `o.hook()`），故清单只声明 id，实现在 `useAppGlobalEffects` 的适配器表里；
 *   两者由 `Record<ReactHookOwnerId, …>` 对齐 —— 清单增删一条而适配器漏改，`tsc` 报错。
 *
 * 新增 owner = 在清单加一行（`preRender`）或「清单一行 + 适配器一行」（`reactHook`）。
 */
import { registerNewTabDockPolicy } from '@/app/dock/registerNewTabDockPolicy';
import { registerGlobalErrorHandlers } from '@/app/registerGlobalErrorHandlers';
import { startQuickOpenActivityTracking } from '@/features/quick-open';
import { initScrollAutoHide } from '@/shared/utils/scrollAutoHide';
import { preloadRendererAddons } from '@/shared/utils/terminal';
import { installWebKitInputGuard } from '@/shared/utils/webkitInputGuard';

import { applyThemeHintBeforeRender } from './configProjection';

/**
 * 安装时机：
 * - `preRender` —— `bootstrap()` 在 `createRoot().render()` 之前跑；
 * - `reactHook` —— 由 React 适配器（`useAppGlobalEffects`）无条件调用一次。
 */
export type GlobalOwner =
  | {
      readonly id: string;
      readonly phase: 'preRender';
      /** 启动即执行；返回 cleanup 时由 `installGlobalOwners` 的 dispose 逆序回收。 */
      readonly start: () => void | (() => void);
    }
  | { readonly id: string; readonly phase: 'reactHook' };

/**
 * 清单顺序即启动顺序。
 *
 * - `preloadRendererAddons` 必须在任何终端创建之前（renderer 预热的模块缓存竞态契约，
 *   见 `shared/utils/terminal.ts` 顶部）；
 * - `themeHint` 必须在 renderer 就绪之后、`render()` 之前 —— 否则 CSS 首帧会先用
 *   `DEFAULT_CONFIG.theme` 兜底、加载完再翻转（整窗闪黑）。
 */
export const GLOBAL_OWNERS = [
  { id: 'errorHandlers', phase: 'preRender', start: registerGlobalErrorHandlers },
  { id: 'webkitInputGuard', phase: 'preRender', start: () => installWebKitInputGuard(document) },
  { id: 'rendererAddons', phase: 'preRender', start: preloadRendererAddons },
  { id: 'newTabDockPolicy', phase: 'preRender', start: registerNewTabDockPolicy },
  { id: 'themeHint', phase: 'preRender', start: applyThemeHintBeforeRender },
  { id: 'quickOpenTracking', phase: 'preRender', start: startQuickOpenActivityTracking },
  { id: 'scrollAutoHide', phase: 'preRender', start: () => initScrollAutoHide() },
  // React-hook 型：hooks 规则要求静态调用顺序，实现见 useAppGlobalEffects 的适配器表
  { id: 'liveSessionsBridge', phase: 'reactHook' },
] as const satisfies readonly GlobalOwner[];

/** 清单里 `reactHook` 形态 owner 的 id 集合（适配器表的键必须与它**完全一致**）。 */
export type ReactHookOwnerId = Extract<
  (typeof GLOBAL_OWNERS)[number],
  { phase: 'reactHook' }
>['id'];

/** 启动全部 `preRender` owner，返回按逆序调用的 dispose（HMR / 测试可用）。 */
export function installGlobalOwners(): () => void {
  const cleanups: Array<() => void> = [];
  for (const owner of GLOBAL_OWNERS) {
    if (owner.phase !== 'preRender') continue;
    const cleanup = owner.start();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  }
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
