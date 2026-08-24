import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import React, { useState } from 'react';

import { cn } from '@/lib/utils';
import { MarkdownPreview } from '@/ui/MarkdownPreview';

import type { MessageBlock } from '../types';
import { HighlightedText } from '../utils/HighlightedText';
import { pairToolBlocks, type PairedBlock } from '../utils/pairToolBlocks';
import { getToolIcon, getToolSummary } from '../utils/toolPresentation';

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

export const TextBlock: React.FC<{ text: string; highlightQuery?: string }> = ({
  text,
  highlightQuery,
}) => {
  const normalizedText = normalizeMarkdown(text);
  if (highlightQuery && normalizedText.toLowerCase().includes(highlightQuery.toLowerCase())) {
    return <HighlightedText text={normalizedText} query={highlightQuery} />;
  }
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
          <span className="text-text-secondary/40 truncate ml-2">{thinking.slice(0, 80)}...</span>
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

/** 稳定工具图标组件（避免渲染期创建组件触发 static-components）。 */
export const ToolIcon: React.FC<{ name: string; className?: string }> = ({ name, className }) =>
  React.createElement(getToolIcon(name), { className });

const ToolUseBlock: React.FC<{ name: string; input: unknown }> = ({ name, input }) => {
  const [expanded, setExpanded] = useState(false);
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
        <ToolIcon name={name} className="w-3.5 h-3.5 text-accent-blue shrink-0" />
        <span className="font-medium text-accent-blue">{name}</span>
        {summary && <span className="text-text-secondary/60 truncate ml-1">{summary}</span>}
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

const ToolResultBlock: React.FC<{ content: string; isError: boolean }> = ({ content, isError }) => {
  const [expanded, setExpanded] = useState(false);
  const preview = content.slice(0, 100);

  return (
    <div
      className={cn(
        'my-2 border rounded-lg overflow-hidden',
        isError ? 'border-red-500/30 bg-red-500/5' : 'border-green-500/30 bg-green-500/5',
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
        {preview && <span className="text-text-secondary/60 truncate ml-1">{preview}...</span>}
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

// ─── Tool Group Block（toolUse + toolResult 配对）─────────────────────────────

const ToolGroupBlock: React.FC<{
  toolUse: Extract<MessageBlock, { type: 'toolUse' }>;
  toolResult: Extract<MessageBlock, { type: 'toolResult' }> | null;
}> = ({ toolUse, toolResult }) => {
  const [expanded, setExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const summary = getToolSummary(toolUse.name, toolUse.input);

  // 错误结果默认展开；成功结果默认折叠
  const resultOpen = toolResult?.isError ? true : resultExpanded;

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
        <ToolIcon name={toolUse.name} className="w-3.5 h-3.5 text-accent-blue shrink-0" />
        <span className="font-medium text-accent-blue">{toolUse.name}</span>
        {summary && <span className="text-text-secondary/60 truncate ml-1">{summary}</span>}
      </button>
      {expanded && (
        <div className="border-t border-border/50">
          <div className="px-3 py-2 text-xs bg-bg-secondary/50">
            <pre className="overflow-x-auto text-text-secondary/70 text-[11px] leading-relaxed">
              {JSON.stringify(toolUse.input, null, 2)}
            </pre>
          </div>
          {toolResult && (
            <button
              type="button"
              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-bg-hover transition-colors border-t border-border/50"
              onClick={() => setResultExpanded(!resultExpanded)}
            >
              {resultOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0" />
              )}
              {toolResult.isError ? (
                <X className="w-3.5 h-3.5 text-red-400 shrink-0" />
              ) : (
                <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
              )}
              <span className="font-medium">{toolResult.isError ? 'Error' : 'Result'}</span>
              {!resultOpen && (
                <span className="text-text-secondary/60 truncate ml-1">
                  {toolResult.content.slice(0, 100)}...
                </span>
              )}
            </button>
          )}
          {resultOpen && toolResult && (
            <div className="px-3 py-2 text-xs bg-bg-secondary/50 border-t border-border/50">
              <pre className="overflow-x-auto text-text-secondary/70 whitespace-pre-wrap text-[11px] leading-relaxed">
                {toolResult.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Main Export ─────────────────────────────────────────────────────────────

export const MessageBlockRenderer: React.FC<{
  block: MessageBlock;
  highlightQuery?: string;
}> = ({ block, highlightQuery }) => {
  switch (block.type) {
    case 'text':
      return <TextBlock text={block.text} highlightQuery={highlightQuery} />;
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

/** 渲染单个 PairedBlock（含 toolUse+toolResult 合并组）。 */
const PairedBlockRenderer: React.FC<{
  block: PairedBlock;
  highlightQuery?: string;
}> = ({ block, highlightQuery }) => {
  if (block.type === 'tool') {
    return <ToolGroupBlock toolUse={block.toolUse} toolResult={block.toolResult} />;
  }
  return <MessageBlockRenderer block={block} highlightQuery={highlightQuery} />;
};

/** 接收 blocks 数组，先做 toolUse/toolResult 配对再渲染。 */
export const MessageBlockList: React.FC<{
  blocks: MessageBlock[];
  highlightQuery?: string;
}> = ({ blocks, highlightQuery }) => {
  const paired = pairToolBlocks(blocks);
  return (
    <div className="space-y-0.5">
      {paired.map((block, idx) => (
        <PairedBlockRenderer key={idx} block={block} highlightQuery={highlightQuery} />
      ))}
    </div>
  );
};

export default MessageBlockRenderer;
