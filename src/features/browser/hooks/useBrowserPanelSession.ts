import { useEffect } from 'react';

import { useProjectBrowserStore, type BrowserPanelState } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { reportFrontendError } from '@/shared/utils/errorReporting';

import { browserClose, browserSetVisible } from '../api/browserApi';
import { BROWSER_PANEL_ID, decideProjectSwitchDock } from '../utils/projectSwitchDock';

import { getProjectBrowserLabel } from './useBrowserConstants';

interface UseBrowserPanelSessionParams {
  activeProjectId: string | null;
  label: string | null;
  browserState: BrowserPanelState | null;
  /** 需要写入（mount 恢复时置 true），故为可变结构而非只读 RefObject */
  isCreatedRef: { current: boolean };
  setVisible: (visible: boolean) => Promise<void>;
  navigate: (url: string) => Promise<void>;
  syncBoundsNextFrame: () => void;
  disarmAutoRefresh: () => void;
  disarmLoadingTimeout: () => void;
}

/**
 * 浏览器面板会话生命周期：挂载恢复 / 项目切换 dock 决策 / dock 可见性跟随 /
 * beforeunload 清理 / 卸载清理。
 *
 * 只编排「何时显示/销毁」，不实现导航与事件解析；行为回调由 useBrowserPanel 注入。
 */
export function useBrowserPanelSession({
  activeProjectId,
  label,
  browserState,
  isCreatedRef,
  setVisible,
  navigate,
  syncBoundsNextFrame,
  disarmAutoRefresh,
  disarmLoadingTimeout,
}: UseBrowserPanelSessionParams): void {
  // On project switch: hide previous project's webview, adjust the right dock
  // according to the next project's browser state (opened → restore panel layout,
  // not opened → do not show an empty browser panel), then show its webview if any.
  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state, prev) => {
      if (state.activeProjectId === prev.activeProjectId) return;

      // Hide previous project's webview
      if (prev.activeProjectId) {
        browserSetVisible(getProjectBrowserLabel(prev.activeProjectId), false).catch((err) =>
          reportFrontendError('browser.setVisible', err),
        );
      }

      const nextProjectId = state.activeProjectId;
      if (!nextProjectId) return;

      const nextState = useProjectBrowserStore.getState().getPanelState(nextProjectId);
      const right = useDockStore.getState().zones.right;
      const action = decideProjectSwitchDock(
        {
          panels: right?.panels ?? [],
          activePanelId: right?.activePanelId ?? null,
          expanded: right?.expanded ?? false,
        },
        nextState.isCreated,
      );

      switch (action.type) {
        case 'none':
          break;
        case 'activate':
          useDockStore.getState().activatePanel('right', action.panelId);
          break;
        case 'add-and-activate':
          useDockStore.getState().togglePanel(action.panelId);
          break;
        case 'collapse':
          useDockStore.getState().togglePanel(BROWSER_PANEL_ID);
          break;
      }

      // Show the new project's webview (if created)
      if (nextState.isCreated) {
        browserSetVisible(getProjectBrowserLabel(nextProjectId), true).catch((err) =>
          reportFrontendError('browser.setVisible', err),
        );
      }
      // 记录活跃时间,驱动闲置回收
      useProjectBrowserStore.getState().setPanelState(nextProjectId, {
        lastActiveAt: Date.now(),
      });
    });
    return () => unsubscribe();
  }, []);

  // Listen to dock panel changes, control webview visibility
  useEffect(() => {
    const unsubscribe = useDockStore.subscribe((state) => {
      const zone = state.zones.right;
      const isVisible = zone?.expanded === true && zone?.activePanelId === 'browser';
      setVisible(isVisible);
    });
    return () => unsubscribe();
  }, [setVisible]);

  // On mount: restore or navigate
  useEffect(() => {
    if (!activeProjectId) return;

    if (browserState?.isCreated) {
      isCreatedRef.current = true;
      const dockState = useDockStore.getState();
      const zone = dockState.zones.right;
      const shouldBeVisible = zone?.expanded === true && zone?.activePanelId === 'browser';
      setVisible(shouldBeVisible);
      if (shouldBeVisible) {
        // 延迟到下一帧布局完成后采样,避免 mount 时 flex layout 未稳定
        syncBoundsNextFrame();
      }
    } else {
      const { url: pendingUrl } = browserState ?? {};
      if (pendingUrl) {
        // 有 URL 但 webview 未创建:外部 navigateTo 或闲置回收后重建
        void navigate(pendingUrl);
      } else if (label) {
        // No pending navigation — hide any orphaned webview
        browserSetVisible(label, false).catch((err) =>
          reportFrontendError('browser.setVisible', err),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // Before page unloads, close the child webview
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (activeProjectId && label) {
        browserClose(label).catch((err) => reportFrontendError('browser.close', err));
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeProjectId, label]);

  // Hide webview on unmount instead of destroying it
  useEffect(() => {
    return () => {
      disarmAutoRefresh();
      disarmLoadingTimeout();
      if (activeProjectId) setVisible(false);
    };
  }, [activeProjectId, setVisible, disarmAutoRefresh, disarmLoadingTimeout]);
}
