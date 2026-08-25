import { Globe } from 'lucide-react';
import React, { useCallback, useEffect } from 'react';

import { useAppContext } from '@/shared/contexts/AppContext';

import { useBrowserTab } from '../hooks/useBrowserTab';

import BrowserToolbar from './BrowserToolbar';

interface BrowserTabViewProps {
  tabKey: string;
  tabId: string;
  projectId: string;
  /** 该 tab 是否可见（所在 pane 为当前激活组且项目激活）。 */
  isActive: boolean;
}

/**
 * 编辑器 Browser tab 内容视图。
 *
 * 与 dock 的 `BrowserPanel` 同构：Toolbar + 容器占位 + 悬浮 webview bounds 同步，
 * 但状态来自 per-tab store（`useBrowserTabsStore`），可见性由 `isActive` 驱动。
 */
const BrowserTabView: React.FC<BrowserTabViewProps> = ({ tabKey, tabId, projectId, isActive }) => {
  const { showToast } = useAppContext();
  const {
    url,
    title,
    favicon,
    isCreated,
    isLoading,
    canGoBack,
    canGoForward,
    containerRef,
    navigate,
    refresh,
    goBack,
    goForward,
    openDevTools,
    openExternal,
    closePage,
    updateBounds,
    isPicking,
    startPicker,
    stopPicker,
  } = useBrowserTab({ tabKey, tabId, projectId, isActive, showToast });

  // webview 创建后同步一次 bounds（延迟到下一帧，flex layout 稳定后采样）
  useEffect(() => {
    if (isCreated && containerRef.current) {
      const id = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        updateBounds(containerRef.current.getBoundingClientRect());
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isCreated, containerRef, updateBounds]);

  const handleTogglePicker = useCallback(() => {
    if (isPicking) {
      stopPicker();
    } else {
      startPicker();
    }
  }, [isPicking, startPicker, stopPicker]);

  const handleNavigate = useCallback(
    (newUrl: string) => {
      navigate(newUrl);
    },
    [navigate],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <BrowserToolbar
        url={url}
        favicon={favicon}
        title={title}
        isLoading={isLoading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onNavigate={handleNavigate}
        onRefresh={refresh}
        onGoBack={goBack}
        onGoForward={goForward}
        onOpenExternal={openExternal}
        onOpenDevTools={openDevTools}
        onClosePage={closePage}
        isPicking={isPicking}
        onTogglePicker={handleTogglePicker}
      />

      {/* Webview 占位区域：悬浮 OS webview 定位于此容器 */}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        {!isCreated && !isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)]">
            <Globe size={48} strokeWidth={1} />
            <span className="text-sm" style={{ fontSize: 'var(--font-size)' }}>
              Enter a URL to browse
            </span>
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-secondary)]">
            <span className="text-sm" style={{ fontSize: 'var(--font-size)' }}>
              Loading...
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(BrowserTabView);
