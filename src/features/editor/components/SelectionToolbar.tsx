import React, { useState, useEffect, useRef } from 'react';
import type { EditorAction } from '@/shared/utils/agentPrompt';

interface SelectionToolbarProps {
  visible: boolean;
  top: number;
  left: number;
  onAction: (action: EditorAction, question?: string) => void;
  needsAgentTab: boolean;
  agentName?: string;
  onCreateTab: () => void;
}

const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  visible,
  top,
  left,
  onAction,
  needsAgentTab,
  agentName,
  onCreateTab,
}) => {
  const [showAskInput, setShowAskInput] = useState(false);
  const [askText, setAskText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showAskInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showAskInput]);

  if (!visible) return null;

  const handleAskSend = () => {
    if (askText.trim()) {
      onAction('ask', askText.trim());
      setAskText('');
      setShowAskInput(false);
    }
  };

  return (
    <div
      className="fixed z-[9999]"
      style={{ top: top - 36, left }}
    >
      {needsAgentTab ? (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-tertiary border border-border shadow-lg text-sm whitespace-nowrap">
          <span className="text-text-muted">No agent terminal open</span>
          <button
            className="px-2 py-0.5 rounded bg-accent text-white text-xs font-medium hover:opacity-90 transition"
            onClick={onCreateTab}
          >
            Open {agentName || 'Agent'} Terminal
          </button>
        </div>
      ) : showAskInput ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-bg-tertiary border border-border shadow-lg">
          <input
            ref={inputRef}
            className="w-56 px-2 py-1 rounded bg-bg-secondary text-text-primary text-xs outline-none border border-border"
            placeholder="Ask about the selected code..."
            value={askText}
            onChange={e => setAskText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAskSend(); if (e.key === 'Escape') setShowAskInput(false); }}
          />
          <button
            className="px-2 py-1 rounded bg-accent text-white text-xs font-medium hover:opacity-90 transition"
            onClick={handleAskSend}
          >
            Send
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-bg-tertiary border border-border shadow-lg">
          <ToolbarButton onClick={() => setShowAskInput(true)}>Ask</ToolbarButton>
          <ToolbarButton onClick={() => onAction('explain')}>Explain</ToolbarButton>
          <ToolbarButton onClick={() => onAction('review')}>Review</ToolbarButton>
          <ToolbarButton onClick={() => onAction('fix')}>Fix</ToolbarButton>
        </div>
      )}
    </div>
  );
};

const ToolbarButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <button
    className="px-2 py-1 rounded text-xs text-text-primary hover:bg-bg-hover font-medium transition whitespace-nowrap"
    onClick={onClick}
  >
    {children}
  </button>
);

export default React.memo(SelectionToolbar);
