import { Globe } from 'lucide-react';
import React, { useRef, useCallback, useEffect } from 'react';

import { useAppContext } from '@/shared/contexts/AppContext';

import { useBrowserPanel } from '../hooks/useBrowserPanel';

import BrowserToolbar from './BrowserToolbar';

const BrowserPanel: React.FC = () => {
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
    updateBounds,
    isPicking,
    startPicker,
    stopPicker,
  } = useBrowserPanel({ showToast });

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Sync position when webview is created
  useEffect(() => {
    if (isCreated && containerRef.current) {
      // 延迟到下一帧,确保 flex layout 完成后取到准确 rect
      const id = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        updateBounds(containerRef.current.getBoundingClientRect());
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isCreated, containerRef, updateBounds]);

  // Listen to container size changes, sync webview position and size
  useEffect(() => {
    if (!containerRef.current) return;

    resizeObserverRef.current = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      updateBounds(rect);
    });

    resizeObserverRef.current.observe(containerRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [containerRef, updateBounds]);

  // Listen to window resize events
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      updateBounds(rect);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [containerRef, updateBounds]);

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
    <div className="flex flex-col h-full">
      {/* Toolbar */}
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
        isPicking={isPicking}
        onTogglePicker={handleTogglePicker}
      />

      {/* Webview placeholder area */}
      <div ref={containerRef} className="flex-1 relative">
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

export default React.memo(BrowserPanel);
