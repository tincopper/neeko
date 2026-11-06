import { useEffect } from 'react';

import { useAgentStore } from '@/shared/store/agentStore';

/**
 * 启动期预热 agent 配置缓存。
 *
 * # 为什么独立成 hook
 *
 * `useAppConfigOwner` 受 `check_component_size` 的 ratchet 约束（只许缩小）。这段
 * 逻辑与配置加载**互不依赖**：不 await、不读 `load_config` 的结果、失败也不
 * 中断启动。混在一起会让配置 hook 为一件无关的事增长。
 *
 * # 为什么失败不阻塞
 *
 * 缓存未命中时终端**不启动** agent（`agentStore.byId` 返回 `undefined`），
 * 用户下次打开 agent 时会再触发一次 `refresh`。为一次瞬时的 IPC 失败阻断
 * 整个应用启动是更坏的取舍。
 */
export function useAgentPreload(): void {
  useEffect(() => {
    void useAgentStore
      .getState()
      .refresh()
      .catch((e) => console.error('[App] Failed to preload agents:', e));
  }, []);
}
