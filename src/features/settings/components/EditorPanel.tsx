import React, { useMemo } from 'react';

import type { AgentConfig } from '@/shared/types';
import { agentCapabilities } from '@/shared/types/agent';
import { Separator, Switch } from '@/ui';

interface EditorPanelProps {
  editorFontSize: number;
  onEditorFontSizeChange: (size: number) => void;
  /** Recommended editor size: follows terminal, for the reset button */
  /** 切换 file tab 时自动在文件树中定位该文件 */
  autoLocateFileOnTabSwitch: boolean;
  onAutoLocateFileOnTabSwitchChange: (enabled: boolean) => void;
  /** AI 翻译默认项 */
  translationAgentId?: string;
  translationTargetLanguage?: string;
  agents: AgentConfig[];
  onTranslationAgentChange: (agentId: string) => void;
  onTranslationTargetLanguageChange: (language: string) => void;
}

/** 目标语言选项：value 为翻译 prompt 使用的语言名，label 为设置页英文展示 */
const TRANSLATION_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: '简体中文', label: 'Simplified Chinese' },
  { value: '繁體中文', label: 'Traditional Chinese' },
  { value: 'English', label: 'English' },
  { value: '日本語', label: 'Japanese' },
  { value: '한국어', label: 'Korean' },
];

const selectClass =
  'bg-bg-tertiary border border-border rounded text-[0.86em] text-text-primary px-2 py-1 outline-none focus:border-accent-blue';

const EditorPanel: React.FC<EditorPanelProps> = ({
  editorFontSize,
  onEditorFontSizeChange,
  autoLocateFileOnTabSwitch,
  onAutoLocateFileOnTabSwitchChange,
  translationAgentId,
  translationTargetLanguage,
  agents,
  onTranslationAgentChange,
  onTranslationTargetLanguageChange,
}) => {
  // 翻译走 AgentAdapter 抽象（adapter_for），默认 Agent 也仅 CHAT 能力可选
  const chatAgents = useMemo(() => agents.filter((a) => agentCapabilities(a).chat), [agents]);

  return (
    <>
      <h3 className="text-base font-semibold text-text-primary mb-4">Editor</h3>
      <Separator className="mb-5" />
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Font Size</div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Font size for the file editor.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="size-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            onClick={() => onEditorFontSizeChange(editorFontSize - 1)}
            disabled={editorFontSize <= 10}
          >
            &minus;
          </button>
          <span className="min-w-[44px] text-center text-[0.86em] text-text-primary tabular-nums">
            {editorFontSize}px
          </span>
          <button
            className="size-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            onClick={() => onEditorFontSizeChange(editorFontSize + 1)}
            disabled={editorFontSize >= 24}
          >
            +
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Auto-locate file on tab switch
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            When switching file tabs, automatically reveal the file in the file tree.
          </div>
        </div>
        <Switch
          checked={autoLocateFileOnTabSwitch}
          onCheckedChange={onAutoLocateFileOnTabSwitchChange}
        />
      </div>
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Default Translation Agent
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Default agent used by the AI Translate view for Markdown / HTML / TXT documents.
          </div>
        </div>
        <select
          className={selectClass}
          value={translationAgentId ?? ''}
          onChange={(e) => onTranslationAgentChange(e.target.value)}
          aria-label="Default translation agent"
        >
          <option value="">Agent default</option>
          {chatAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Default Target Language
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Default target language used by the AI Translate view.
          </div>
        </div>
        <select
          className={selectClass}
          value={translationTargetLanguage ?? ''}
          onChange={(e) => onTranslationTargetLanguageChange(e.target.value)}
          aria-label="Default translation target language"
        >
          <option value="">Simplified Chinese (default)</option>
          {TRANSLATION_LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
};

export default React.memo(EditorPanel);
