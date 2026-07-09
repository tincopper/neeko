import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
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
import { cn } from '@/lib/utils';
import type { MessageBlock } from '../types';
import 'highlight.js/styles/github-dark.min.css';

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
  return (
    <div className="prose prose-sm max-w-none prose-invert prose-p:my-1 prose-headings:text-text-primary prose-headings:my-2 prose-code:before:content-none prose-code:after:content-none prose-code:text-accent-blue prose-code:bg-bg-tertiary/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-[#0d1117] prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-a:text-accent-blue prose-li:text-text-primary prose-li:my-0.5 prose-strong:text-text-primary prose-table:border prose-table:border-border prose-table:w-full prose-th:bg-bg-secondary prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-medium prose-th:border prose-th:border-border prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-border">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeHighlight]}>
        {normalizedText}
      </ReactMarkdown>
    </div>
  );
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
