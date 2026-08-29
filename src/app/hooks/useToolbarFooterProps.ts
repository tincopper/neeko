import { useCallback } from 'react';

import { useAppViewStore } from '@/shared/store/appViewStore';
import { IS_WINDOWS } from '@/shared/utils/platform';

import type { ToolbarFooterProps } from '../components/ToolbarFooter';

const noop = () => {};

/**
 * 左 DockBar 底部按钮簇的回调装配（settings 切换走 appView 单一路由源；
 * WSL 入口按平台门控）。原 layout/hooks/useAppLayoutProps，随 AppLayout
 * 消解迁入 app 层。
 */
export function useToolbarFooterProps(opts: {
  onAddProject: () => void;
  onOpenWslDialog: () => void;
  onOpenRemoteDialog: () => void;
}): ToolbarFooterProps {
  const handleToggleSettings = useCallback(() => {
    const currentView = useAppViewStore.getState().appView;
    useAppViewStore.getState().setAppView(currentView === 'settings' ? 'normal' : 'settings');
  }, []);

  return {
    onAddProject: opts.onAddProject,
    onAddWsl: IS_WINDOWS ? opts.onOpenWslDialog : noop,
    onAddRemote: opts.onOpenRemoteDialog,
    onOpenSettings: handleToggleSettings,
  };
}
