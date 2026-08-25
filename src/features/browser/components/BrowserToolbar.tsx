import { RefreshCw as RefreshCwIcon } from 'lucide-react';
import React, { useCallback, useEffect, useState, type KeyboardEvent } from 'react';

import {
  ArrowLeft,
  ArrowRight,
  Bug,
  CloseIcon,
  ExternalLink,
  MousePointerClick,
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
  onClosePage: () => void;
  isPicking: boolean;
  onTogglePicker: () => void;
}

const BTN_BASE =
  'flex items-center justify-center w-6 h-6 rounded-md text-text-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const BTN = `${BTN_BASE} hover:bg-bg-hover hover:text-text-primary`;
// 关闭按钮 hover 变红（危险操作语义），与普通按钮区分
const CLOSE_BTN = `${BTN_BASE} hover:bg-bg-hover hover:text-[var(--accent-red)]`;
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
  onClosePage,
  isPicking,
  onTogglePicker,
}) => {
  const [inputValue, setInputValue] = useState(url);
  // 编辑态：用户聚焦地址栏后，输入框展示可编辑的 URL；失焦后恢复标题/URL 展示。
  const [editing, setEditing] = useState(false);

  // Sync input value when URL changes (仅非编辑态，避免打断用户输入)
  useEffect(() => {
    if (editing) return;
    // Defer to avoid sync setState in effect
    Promise.resolve().then(() => setInputValue(url));
  }, [url, editing]);

  const handleFocus = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      setEditing(true);
      setInputValue(url);
      // 类浏览器地址栏：聚焦即全选，输入直接替换旧 URL
      e.target.select();
    },
    [url],
  );

  const handleBlur = useCallback(() => {
    setEditing(false);
  }, []);

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
        <RefreshCwIcon size={12} className={isLoading ? 'animate-spin' : ''} />
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
          value={editing ? inputValue : title || url}
          onFocus={handleFocus}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleBlur}
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

      {/* DevTools */}
      <button onClick={onOpenDevTools} disabled={!url} className={BTN} title="Open DevTools">
        <Bug size={12} />
      </button>

      {/* 关闭页面：回收 webview 资源 */}
      <button onClick={onClosePage} disabled={!url} className={CLOSE_BTN} title="Close page">
        <CloseIcon size={12} />
      </button>
    </div>
  );
};

export default React.memo(BrowserToolbar);
