import React, { useCallback, useEffect, useState, type KeyboardEvent } from 'react';

import {
  ArrowLeft,
  ArrowRight,
  Bug,
  ExternalLink,
  Maximize,
  MousePointerClick,
  RefreshCw,
} from '@/shared/components/icons';

interface BrowserToolbarProps {
  url: string;
  title: string;
  favicon: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigate: (url: string) => void;
  onRefresh: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onOpenExternal: () => void;
  onOpenDevTools: () => void;
  onResetZoom: () => void;
  isPicking: boolean;
  onTogglePicker: () => void;
}

const BTN =
  'flex items-center justify-center w-6 h-6 rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const BrowserToolbar: React.FC<BrowserToolbarProps> = ({
  url,
  title,
  favicon,
  isLoading,
  canGoBack,
  canGoForward,
  onNavigate,
  onRefresh,
  onGoBack,
  onGoForward,
  onOpenExternal,
  onOpenDevTools,
  onResetZoom,
  isPicking,
  onTogglePicker,
}) => {
  const [inputValue, setInputValue] = useState(url);

  // Sync input value when URL changes
  useEffect(() => {
    // Defer to avoid sync setState in effect
    Promise.resolve().then(() => setInputValue(url));
  }, [url]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        let finalUrl = inputValue.trim();
        if (
          finalUrl &&
          !finalUrl.startsWith('http://') &&
          !finalUrl.startsWith('https://') &&
          !finalUrl.startsWith('file://')
        ) {
          finalUrl = 'https://' + finalUrl;
        }
        if (finalUrl) {
          onNavigate(finalUrl);
        }
      }
    },
    [inputValue, onNavigate],
  );

  return (
    <div className="flex items-center gap-1 h-8 px-2 bg-bg-secondary shrink-0">
      {/* 后退 */}
      <button onClick={onGoBack} disabled={!canGoBack} className={BTN} title="Back">
        <ArrowLeft size={12} />
      </button>

      {/* 前进 */}
      <button onClick={onGoForward} disabled={!canGoForward} className={BTN} title="Forward">
        <ArrowRight size={12} />
      </button>

      {/* 刷新 */}
      <button onClick={onRefresh} disabled={isLoading || !url} className={BTN} title="Refresh">
        <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
      </button>

      {/* 地址栏:有标题时显示标题 + favicon,否则降级显示 URL */}
      <div
        className="flex flex-1 h-5 px-2 text-xs bg-bg-primary text-text-primary border border-border rounded focus-within:border-accent-blue items-center gap-1.5 min-w-0"
        title={url}
      >
        {favicon && (
          <img
            src={favicon}
            alt=""
            className="w-3.5 h-3.5 shrink-0"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        <input
          type="text"
          value={title || url}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter URL..."
          className="flex-1 min-w-0 bg-transparent border-none outline-none placeholder:text-text-muted"
        />
      </div>

      {/* 元素选择器 */}
      <button
        onClick={onTogglePicker}
        disabled={!url}
        className={BTN + (isPicking ? ' !text-accent-blue !bg-accent-blue/10' : '')}
        title={isPicking ? 'Stop picking' : 'Pick element'}
      >
        <MousePointerClick size={12} />
      </button>

      {/* 在默认浏览器中打开 */}
      <button
        onClick={onOpenExternal}
        disabled={!url}
        className={BTN}
        title="Open in default browser"
      >
        <ExternalLink size={12} />
      </button>

      {/* 重置缩放 */}
      <button onClick={onResetZoom} disabled={!url} className={BTN} title="Reset zoom (100%)">
        <Maximize size={12} />
      </button>

      {/* DevTools */}
      <button onClick={onOpenDevTools} disabled={!url} className={BTN} title="Open DevTools">
        <Bug size={12} />
      </button>
    </div>
  );
};

export default React.memo(BrowserToolbar);
