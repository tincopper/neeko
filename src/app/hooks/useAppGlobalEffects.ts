import type { ReactHookOwnerId } from '@/app/bootstrap/globalOwners';
import { useLiveSessionsBridge } from '@/features/live-sessions';

/**
 * React 侧的全局 owner **适配器表** —— `GLOBAL_OWNERS` 里 `reactHook` 条目的实现。
 *
 * 为什么不是遍历清单调 `o.hook()`：React hooks 要求调用顺序静态（条件/循环调用会破坏
 * hook 顺序），所以实现必须留在一个固定位置。清单与实现的对应关系交给类型：
 * 键类型是 `ReactHookOwnerId`，清单增删一条而本表漏改 → `tsc` 直接报错。
 *
 * 为什么 live-sessions 必须全局唯一：快照是 `AGENT_CHAT_EVENT` 的唯一消费者，
 * tab 卸载后若无人消费，会话状态就没有第二个来源。调用点数量由
 * `check_config_owner_singleton` 护栏钉死为 1。
 */
const REACT_HOOK_ADAPTERS: Record<ReactHookOwnerId, () => void> = {
  liveSessionsBridge: useLiveSessionsBridge,
};

/**
 * React 侧**唯一**的全局 owner 安装点（组合根 `useAppShell` 无条件调用一次）。
 *
 * 其余「恰好一次」owner 已在 `bootstrap/globalOwners.ts` 的唯一清单里由 `bootstrap()`
 * 安装；渲染型宿主（dialog host）保持原位，不入本清单。
 */
export function useAppGlobalEffects(): void {
  // 逐条显式调用：hooks 规则要求静态顺序，故不遍历表
  REACT_HOOK_ADAPTERS.liveSessionsBridge();
}
