import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { MarkdownPreview } from '@/ui/MarkdownPreview';
import type { MessageBlock } from '../types';
import {
  ChevronDown,
  ChevronRight,
  File,
  Terminal,
  Search,
  Edit,
  Check,
  X,
} from 'lucide-react';

// 工具图标映射
const TOOL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Read: File,
  Write: Edit,
  Edit: Edit,
  Bash: Terminal,
  Grep: Search,
  Glob: Search,
  GlobSearch: Search,
  LS: File,
  Cat: File,
};

// 工具摘要提取
function getToolSummary(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;

  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'LS':
    case 'Cat':
      return (obj.file_path ?? obj.path ?? '') as string;
    case 'Bash':
      return (obj.command ?? '') as string;
    case 'Grep':
    case 'Glob':
    case 'GlobSearch':
      return (obj.pattern ?? '') as string;
    default:
      return JSON.stringify(input).slice(0, 60);
  }
}

// ─── Text Block ──────────────────────────────────────────────────────────────

// 确保 markdown 内容有正确的格式（表格前需要空行，但表格行之间不能有空行）
function normalizeMarkdown(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTableLine = line.trim().startsWith('|');
    const prevLine = result.length > 0 ? result[result.length - 1] : '';
    const prevIsTableLine = prevLine.trim().startsWith('|');

    // 如果当前行是表格行，且前一行不是空行也不是表格行，插入空行
    if (isTableLine && i > 0 && prevLine.trim() !== '' && !prevIsTableLine) {
      result.push('');
    }

    result.push(line);
  }

  return result.join('\n');
}

export const TextBlock: React.FC<{ text: string }> = ({ text }) => {
  const normalizedText = normalizeMarkdown(text);
  const theme = document.documentElement.getAttribute('data-theme') || 'classic-dark';
  return <MarkdownPreview content={normalizedText} theme={theme} />;
};

// ─── Thinking Block ──────────────────────────────────────────────────────────

const ThinkingBlock: React.FC<{ thinking: string }> = ({ thinking }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 border border-border/50 rounded-lg overflow-hidden">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        <span className="font-medium">Thinking</span>
        {!expanded && (
          <span className="text-text-secondary/40 truncate ml-2">
            {thinking.slice(0, 80)}...
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 text-xs text-text-secondary/70 bg-bg-secondary/30 border-t border-border/50 whitespace-pre-wrap">
          {thinking}
        </div>
      )}
    </div>
  );
};

// ─── Tool Use Block ──────────────────────────────────────────────────────────

const ToolUseBlock: React.FC<{ name: string; input: unknown }> = ({ name, input }) => {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[name] ?? Terminal;
  const summary = getToolSummary(name, input);

  return (
    <div className="my-2 border border-accent-blue/30 rounded-lg overflow-hidden bg-accent-blue/5">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-accent-blue/10 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        <Icon className="w-3.5 h-3.5 text-accent-blue shrink-0" />
        <span className="font-medium text-accent-blue">{name}</span>
        {summary && (
          <span className="text-text-secondary/60 truncate ml-1">{summary}</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 text-xs bg-bg-secondary/50 border-t border-border/50">
          <pre className="overflow-x-auto text-text-secondary/70 text-[11px] leading-relaxed">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

// ─── Tool Result Block ───────────────────────────────────────────────────────

const ToolResultBlock: React.FC<{ content: string; isError: boolean }> = ({
  content,
  isError,
}) => {
  const [expanded, setExpanded] = useState(false);
  const preview = content.slice(0, 100);

  return (
    <div
      className={cn(
        'my-2 border rounded-lg overflow-hidden',
        isError
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-green-500/30 bg-green-500/5',
      )}
    >
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-bg-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        {isError ? (
          <X className="w-3.5 h-3.5 text-red-400 shrink-0" />
        ) : (
          <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
        )}
        <span className="font-medium">{isError ? 'Error' : 'Result'}</span>
        {preview && (
          <span className="text-text-secondary/60 truncate ml-1">{preview}...</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 text-xs bg-bg-secondary/50 border-t border-border/50">
          <pre className="overflow-x-auto text-text-secondary/70 whitespace-pre-wrap text-[11px] leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
};

// ─── Main Export ─────────────────────────────────────────────────────────────

export const MessageBlockRenderer: React.FC<{ block: MessageBlock }> = ({ block }) => {
  switch (block.type) {
    case 'text':
      return <TextBlock text={block.text} />;
    case 'thinking':
      return <ThinkingBlock thinking={block.thinking} />;
    case 'toolUse':
      return <ToolUseBlock name={block.name} input={block.input} />;
    case 'toolResult':
      return <ToolResultBlock content={block.content} isError={block.isError} />;
    default:
      return null;
  }
};

export default MessageBlockRenderer;
