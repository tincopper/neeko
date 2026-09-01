import { useEffect } from 'react';

import { startQuickOpenActivityTracking } from '@/features/quick-open';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';
import { initScrollAutoHide } from '@/shared/utils/scrollAutoHide';

/**
 * 应用级全局副作用（无返回值、无输入依赖）：
 * - quick-open 活动跟踪
 * - 全局滚动条自动隐藏（滚动时显示，3s 后隐藏）
 * - dockStore 持久化的 skills 激活态 → appView（单一路由源）启动同步
 *
 * 从 useAppShell 抽出，使 shell 仅保留业务编排、副作用收敛到本 hook。
 */
export function useAppGlobalEffects(): void {
  useEffect(() => {
    startQuickOpenActivityTracking();
  }, []);

  useEffect(() => initScrollAutoHide(), []);

  // dockStore 持久化、appViewStore 不持久化：启动时把左 zone 的 skills 激活态同步到 appView
  useEffect(() => {
    const leftActive = useDockStore.getState().zones.left?.activePanelId;
    if (leftActive === 'skills' && useAppViewStore.getState().appView === 'normal') {
      useAppViewStore.getState().setAppView('skills');
    }
  }, []);
}
