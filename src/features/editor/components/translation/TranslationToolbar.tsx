import React from 'react';

import type { ModelInfo } from '@/features/agent/api/agentApi';
import { cn } from '@/lib/utils';
import { Square } from '@/shared/components/icons';
import type { AgentConfig } from '@/shared/types';

export const SUPPORTED_LANGUAGES = ['简体中文', '繁體中文', 'English', '日本語', '한국어'] as const;

const selectClass =
  'bg-bg-secondary border border-border rounded-md text-xs text-text-secondary px-1.5 py-1 outline-none focus:border-accent-blue';

interface TranslationToolbarProps {
  running: boolean;
  /** 进度：已完成段 / 总段 */
  total: number;
  doneCount: number;
  /** 底层文件已变更（提示重新翻译） */
  stale: boolean;
  /** 已有翻译结果（按钮文案区分 首次 / 重译） */
  hasResult: boolean;
  targetLanguage: string;
  agentId: string;
  modelId: string | null;
  chatAgents: AgentConfig[];
  models: ModelInfo[];
  bilingual: boolean;
  onTargetLanguageChange: (value: string) => void;
  onAgentChange: (value: string) => void;
  onModelChange: (value: string | null) => void;
  onBilingualChange: (value: boolean) => void;
  onStop: () => void;
  onRetranslate: () => void;
}

/** 译文视图工具条：语言 / Agent / 模型选择器 + 双语切换 + 进度 / 停止 / 重译 */
const TranslationToolbar: React.FC<TranslationToolbarProps> = ({
  running,
  total,
  doneCount,
  stale,
  hasResult,
  targetLanguage,
  agentId,
  modelId,
  chatAgents,
  models,
  bilingual,
  onTargetLanguageChange,
  onAgentChange,
  onModelChange,
  onBilingualChange,
  onStop,
  onRetranslate,
}) => (
  <>
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border/20 bg-bg-secondary/50 flex-wrap">
      <select
        className={selectClass}
        value={targetLanguage}
        onChange={(e) => onTargetLanguageChange(e.target.value)}
        aria-label="目标语言"
        disabled={running}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={agentId}
        onChange={(e) => onAgentChange(e.target.value)}
        aria-label="翻译 Agent"
        disabled={running}
      >
        {chatAgents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={modelId ?? ''}
        onChange={(e) => onModelChange(e.target.value || null)}
        aria-label="模型"
        disabled={running}
      >
        <option value="">默认模型</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name || model.id}
          </option>
        ))}
      </select>

      <div className="flex border border-border rounded-md overflow-hidden">
        <button
          className={cn(
            'px-2 py-1 text-xs',
            bilingual
              ? 'bg-bg-selected text-text-primary'
              : 'text-text-muted hover:text-text-primary',
          )}
          onClick={() => onBilingualChange(true)}
        >
          双语对照
        </button>
        <button
          className={cn(
            'px-2 py-1 text-xs',
            !bilingual
              ? 'bg-bg-selected text-text-primary'
              : 'text-text-muted hover:text-text-primary',
          )}
          onClick={() => onBilingualChange(false)}
        >
          仅译文
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {running ? (
          <>
            <span className="text-xs text-text-muted">
              Translating {doneCount} / {total}
            </span>
            <button
              className="tb-icon-btn w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              onClick={onStop}
              title="停止"
              aria-label="停止翻译"
            >
              <Square size={12} />
            </button>
          </>
        ) : (
          <button
            className="px-3 py-1 text-xs rounded-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 transition-colors"
            onClick={onRetranslate}
            title={stale ? '文件已变更，重新翻译' : hasResult ? '使用当前选择重新翻译' : '开始翻译'}
          >
            {stale ? '文件已变更 · 重新翻译' : hasResult ? '重新翻译' : 'Translate'}
          </button>
        )}
      </div>
    </div>

    {/* 进度条 */}
    {running && (
      <div className="shrink-0 h-0.5 bg-bg-tertiary">
        <div
          className="h-full bg-accent-blue transition-all duration-300"
          style={{ width: `${total === 0 ? 0 : Math.round((doneCount / total) * 100)}%` }}
        />
      </div>
    )}
  </>
);

export default React.memo(TranslationToolbar);
