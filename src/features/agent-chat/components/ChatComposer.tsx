import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import type { ChangeEvent, KeyboardEvent } from 'react';

import type { ModelInfo } from '@/features/agent/api/agentApi';
import type { AgentConfig } from '@/shared/types/agent';

import { AGENT_MODES, THINKING_LEVELS } from './constants';
import ContextWindowMeter from './ContextWindowMeter';
import type { Attachment } from './messageModel';
import { ModelPicker } from './ModelPicker';
import { ModelSelector } from './ModelSelector';
import { AgentModeSelector, ThinkingLevelSelector } from './ParamSelectors';

interface ChatComposerProps {
  input: string;
  attachments: Attachment[];
  streaming: boolean;
  agentMode: string;
  thinkingLevel: string;
  chatAgents: AgentConfig[];
  models: ModelInfo[];
  selectedModel: ModelInfo | null;
  selectedAgent: { id: string; name: string; tag: string; color: string };
  contextWindow: { used: number; total: number; model: string } | null;
  tabKey: string;
  tabId: string;
  onInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  onRemoveAttachment: (id: string) => void;
  onOpenAttachDrop: () => void;
  onAgentModeChange: (id: string) => void;
  onThinkingLevelChange: (id: string) => void;
  onModelChange: (model: ModelInfo) => void;
}

/** 底部输入区：附件 chips + textarea + 工具栏（模型/参数选择器/发送）。 */
export default function ChatComposer({
  input,
  attachments,
  streaming,
  agentMode,
  thinkingLevel,
  chatAgents,
  models,
  selectedModel,
  selectedAgent,
  contextWindow,
  tabKey,
  tabId,
  onInputChange,
  onKeyDown,
  onSend,
  onStop,
  onRemoveAttachment,
  onOpenAttachDrop,
  onAgentModeChange,
  onThinkingLevelChange,
  onModelChange,
}: ChatComposerProps) {
  return (
    <div className="wa-composer">
      <div className="wa-box">
        {attachments.length > 0 && (
          <div className="wa-at">
            {attachments.map((a) => (
              <span key={a.id} className="attach-chip">
                <span className="at-type">{a.type}</span>
                {a.name}
                <span
                  className="at-close"
                  role="button"
                  tabIndex={0}
                  aria-label={`移除 ${a.name}`}
                  onClick={() => onRemoveAttachment(a.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRemoveAttachment(a.id);
                    }
                  }}
                >
                  <X size={12} />
                </span>
              </span>
            ))}
          </div>
        )}

        <textarea
          className="composer-textarea"
          rows={1}
          placeholder="Type a message..."
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
        />

        <div className="composer-footer">
          <div className="composer-left">
            <ModelSelector
              chatAgents={chatAgents}
              selectedAgent={selectedAgent}
              tabKey={tabKey}
              tabId={tabId}
            />
            <ModelPicker models={models} selected={selectedModel} onChange={onModelChange} />
            <div className="composer-divider" />
            <AgentModeSelector
              modes={AGENT_MODES}
              selected={agentMode}
              onChange={onAgentModeChange}
            />
            <ThinkingLevelSelector
              levels={THINKING_LEVELS}
              selected={thinkingLevel}
              onChange={onThinkingLevelChange}
            />
            {contextWindow && (
              <ContextWindowMeter
                used={contextWindow.used}
                total={contextWindow.total}
                model={contextWindow.model}
              />
            )}
            <div className="composer-divider" />
            <button className="composer-btn" title="Attach files" onClick={onOpenAttachDrop}>
              <Paperclip size={16} />
            </button>
          </div>
          <div className="composer-right">
            {streaming ? (
              <button className="send-btn stop" onClick={onStop} title="Stop">
                <Square size={14} />
              </button>
            ) : (
              <button
                className="send-btn"
                disabled={input.trim().length === 0}
                onClick={onSend}
                title="Send"
              >
                <ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="composer-meta">
        <span>Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
  );
}
