import { Brain, Check, ChevronDown } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import type { AgentConfig } from '@/shared/types/agent';

import { agentColor, agentTag } from './constants';

function ModelSelector({
  chatAgents,
  selectedAgent,
  tabKey,
  tabId,
}: {
  chatAgents: AgentConfig[];
  selectedAgent: { id: string; name: string; tag: string; color: string };
  tabKey: string;
  tabId: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const positionDropdown = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const dropdown = btnRef.current
      .closest('.model-selector-wrap')
      ?.querySelector('.model-dropdown') as HTMLElement;
    if (dropdown) {
      dropdown.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      dropdown.style.left = `${rect.left}px`;
    }
  }, []);

  return (
    <div className="model-selector-wrap">
      <button
        ref={btnRef}
        className={`model-selector-btn${open ? ' open' : ''}`}
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(positionDropdown, 0);
        }}
      >
        <span className="model-icon">
          <Brain size={14} />
        </span>
        <span className="model-name">{selectedAgent.name}</span>
        <span className="model-chevron">
          <ChevronDown size={12} />
        </span>
      </button>
      {open && (
        <>
          <div
            className="drop-overlay"
            role="button"
            tabIndex={0}
            aria-label="关闭下拉菜单"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <div className="model-dropdown show">
            {chatAgents.length === 0 ? (
              <div className="attach-empty">暂无可用的 chat agent</div>
            ) : (
              chatAgents.map((a) => (
                <button
                  key={a.id}
                  className={`model-option${a.id === selectedAgent.id ? ' selected' : ''}`}
                  onClick={() => {
                    useEditorStore.getState().updateTab(tabKey, tabId, { agentId: a.id });
                    setOpen(false);
                  }}
                >
                  <span className="model-opt-icon" style={{ background: agentColor(a.id) }}>
                    {agentTag(a.name)}
                  </span>
                  <span className="model-opt-info">
                    <span className="model-opt-name">{a.name}</span>
                  </span>
                  <span className="model-opt-check">
                    <Check size={12} />
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export { ModelSelector };
