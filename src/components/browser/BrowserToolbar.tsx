import React, { useState, useCallback, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, Bug, ExternalLink, RefreshCw } from "lucide-react";

interface BrowserToolbarProps {
  url: string;
  isLoading: boolean;
  onNavigate: (url: string) => void;
  onRefresh: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onOpenExternal: () => void;
  onOpenDevTools: () => void;
}

const BTN =
  "flex items-center justify-center w-6 h-6 rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const BrowserToolbar: React.FC<BrowserToolbarProps> = ({
  url,
  isLoading,
  onNavigate,
  onRefresh,
  onGoBack,
  onGoForward,
  onOpenExternal,
  onOpenDevTools,
}) => {
  const [inputValue, setInputValue] = useState(url);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        let finalUrl = inputValue.trim();
        if (finalUrl && !finalUrl.startsWith("http://") && !finalUrl.startsWith("https://") && !finalUrl.startsWith("file://")) {
          finalUrl = "https://" + finalUrl;
        }
        if (finalUrl) {
          onNavigate(finalUrl);
        }
      }
    },
    [inputValue, onNavigate],
  );

  // 同步外部 url 变化到输入框
  React.useEffect(() => {
    setInputValue(url);
  }, [url]);

  return (
    <div className="flex items-center gap-1 h-8 px-2 bg-bg-secondary shrink-0">
      {/* 后退 */}
      <button onClick={onGoBack} disabled={!url} className={BTN} title="Back">
        <ArrowLeft size={12} />
      </button>

      {/* 前进 */}
      <button onClick={onGoForward} disabled={!url} className={BTN} title="Forward">
        <ArrowRight size={12} />
      </button>

      {/* 刷新 */}
      <button
        onClick={onRefresh}
        disabled={isLoading || !url}
        className={BTN}
        title="Refresh"
      >
        <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
      </button>

      {/* 地址栏 */}
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter URL..."
        className="flex-1 h-5 px-2 text-xs bg-bg-primary text-text-primary border border-border rounded focus:outline-none focus:border-accent-blue placeholder:text-text-muted"
      />

      {/* 在默认浏览器中打开 */}
      <button onClick={onOpenExternal} disabled={!url} className={BTN} title="Open in default browser">
        <ExternalLink size={12} />
      </button>

      {/* DevTools */}
      <button onClick={onOpenDevTools} disabled={!url} className={BTN} title="Open DevTools">
        <Bug size={12} />
      </button>
    </div>
  );
};

export default React.memo(BrowserToolbar);
