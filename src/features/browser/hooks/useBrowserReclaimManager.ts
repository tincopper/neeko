import { useEffect } from 'react';

import { useProjectBrowserStore } from '@/shared/store/browserStore';
import { useBrowserTabsStore } from '@/shared/store/browserTabsStore';
import { useProjectStore } from '@/shared/store/projectStore';
import {
  DEFAULT_RECLAIM_POLICY,
  decideReclaims,
  type WebviewUsage,
} from '@/shared/utils/reclaimPolicy';

import { browserClose } from '../api/browserApi';

import { getBrowserTabLabel, getProjectBrowserLabel } from './useBrowserConstants';

/** 回收检查周期：60s（与旧 dock panel 行为一致）。 */
const RECLAIM_CHECK_INTERVAL_MS = 60_000;

let reclaimIntervalId: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

/**
 * 统一闲置回收管理器（单实例、引用计数）。
 *
 * 同时覆盖旧 dock panel webview 与编辑器 Browser tab webview：
 * 周期性地从两个 store 收集使用快照，运行共享回收策略（活跃永不回收、
 * 闲置超时回收、总数超限回收最久未用），对命中的 webview 执行 `browserClose`
 * 并复位 `isCreated`（保留 URL/历史，切回时懒重建）。由 `useBrowserWebview`
 * 在任一浏览器 webview（panel 或 tab）挂载时确保启动。
 */
export function useBrowserReclaimManager(): void {
  useEffect(() => {
    refCount += 1;
    if (reclaimIntervalId === null) {
      reclaimIntervalId = setInterval(checkReclaims, RECLAIM_CHECK_INTERVAL_MS);
    }
    return () => {
      refCount -= 1;
      if (refCount === 0 && reclaimIntervalId !== null) {
        clearInterval(reclaimIntervalId);
        reclaimIntervalId = null;
      }
    };
  }, []);
}

/**
 * 执行一次回收检查：收集 panel + tab 使用快照 → 运行共享策略 → 关闭命中 webview。
 *
 * 导出供单测直接调用（纯 store 读写 + browserClose 副作用）。
 */
export function checkReclaims(): void {
  const activeProjectId = useProjectStore.getState().activeProjectId;
  const usages: WebviewUsage[] = [];

  // 旧 dock panel webview（按项目）。
  for (const [projectId, s] of Object.entries(useProjectBrowserStore.getState().states)) {
    usages.push({
      key: `panel:${projectId}`,
      lastActiveAt: s.lastActiveAt,
      isCreated: s.isCreated,
      isActive: projectId === activeProjectId,
    });
  }

  // 编辑器 Browser tab webview（按 tab）。
  for (const [tabId, s] of Object.entries(useBrowserTabsStore.getState().states)) {
    usages.push({
      key: `tab:${tabId}`,
      lastActiveAt: s.lastActiveAt,
      isCreated: s.isCreated,
      isActive: s.isActive,
    });
  }

  const reclaimKeys = decideReclaims(usages, DEFAULT_RECLAIM_POLICY, Date.now());
  for (const key of reclaimKeys) {
    if (key.startsWith('panel:')) {
      const projectId = key.slice('panel:'.length);
      void browserClose(getProjectBrowserLabel(projectId)).catch((err) => {
        console.error('[Browser] Failed to reclaim panel webview:', err);
      });
      useProjectBrowserStore.getState().setPanelState(projectId, {
        isCreated: false,
        isLoading: false,
      });
    } else if (key.startsWith('tab:')) {
      const tabId = key.slice('tab:'.length);
      void browserClose(getBrowserTabLabel(tabId)).catch((err) => {
        console.error('[Browser] Failed to reclaim tab webview:', err);
      });
      useBrowserTabsStore.getState().setTabState(tabId, { isCreated: false, isLoading: false });
    }
  }
}
