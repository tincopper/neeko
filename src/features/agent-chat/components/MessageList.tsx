import { Check, ChevronRight, Copy } from 'lucide-react';
import { useState, type RefObject } from 'react';

import FilesChangedCard from './FilesChangedCard';
import MessageContent from './MessageContent';
import type { ChatMessage, ContentBlock, RenderItem } from './messageModel';
import { mergeAdjacentToolBlocks } from './messageModel';
import TodoListCard from './TodoListCard';
import WorkedCard from './WorkedCard';
import WorkRows from './WorkRows';

interface MessageListProps {
  /** 会话消息流（user / assistant / system）。 */
  messages: ChatMessage[];
  /** read_file 路径点击回调（透传 WorkRows → ReadCard，跳转编辑器）。 */
  onOpenFile?: (filePath: string) => void;
  /** 滚动容器引用（.wa-chat）—— 供虚拟窗口计算（当前消息量级直接渲染）。 */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

/** 推理块 —— `<details>` 折叠：summary 展示 "Thinking + 首段预览"，展开看全文。 */
function ReasoningBlock({ block }: { block: Extract<ContentBlock, { kind: 'reasoning' }> }) {
  const preview = block.text.slice(0, 48);
  return (
    <details className="thinking-block" data-testid="thinking-block">
      <summary className="thinking-summary">
        <ChevronRight size={12} className="thinking-chevron" />
        <span>Thinking</span>
        {preview && <span className="thinking-preview">{preview}</span>}
      </summary>
      <div className="thinking-body">{block.text}</div>
    </details>
  );
}

/** 按 RenderItem 渲染单个内容块（tool 数组 → WorkRows 分组折叠）。 */
function renderBlock(
  item: RenderItem,
  onOpenFile: ((filePath: string) => void) | undefined,
): React.ReactNode {
  if (Array.isArray(item)) {
    return <WorkRows tools={item} onOpenFile={onOpenFile} />;
  }
  switch (item.kind) {
    case 'text':
      return <MessageContent text={item.text} />;
    case 'reasoning':
      return <ReasoningBlock block={item} />;
    case 'tool':
      return <WorkRows tools={[item.tool]} onOpenFile={onOpenFile} />;
    case 'todos':
      return <TodoListCard todos={item.todos} />;
    case 'diff':
      return <FilesChangedCard summary={item.diff} />;
    case 'worked':
      return <WorkedCard summary={item.worked} onOpenFile={onOpenFile} />;
    default:
      return null;
  }
}

/** 提取消息纯文本（text blocks 拼接），供复制按钮使用。 */
function messageText(m: ChatMessage): string {
  return m.blocks
    .map((b) => (b.kind === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** 复制文本 —— 优先 Clipboard API，jsdom/老浏览器降级 execCommand。 */
function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) resolve();
    else reject(new Error('copy failed'));
  });
}

/** 复制按钮 —— 点击复制消息文本，短暂显示 ✓ 反馈。 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void copyText(text).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      className={`msg-copy${copied ? ' copied' : ''}`}
      title={copied ? '已复制' : '复制消息'}
      data-testid="msg-copy"
      onClick={handleCopy}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

/** 消息底部 —— 24H 发送时间 + 复制按钮（右对齐，hover 显示）。 */
function MessageFooter({ ts, text }: { ts?: string; text: string }) {
  return (
    <div className="msg-footer">
      {ts && <span className="msg-time">{ts}</span>}
      <CopyButton text={text} />
    </div>
  );
}

/**
 * 消息流列表 —— 渲染 user（右侧气泡）/ assistant（块序列）/ system（横幅）。
 *
 * 对齐原型 `agent-chat-v2.html` 的 `.msg` / `.bubble`：
 * - 相邻 tool blocks 合并为组（mergeAdjacentToolBlocks → WorkRows 分组折叠）；
 * - reasoning 用 `<details>` 折叠（默认收起，summary 无 emoji）；
 * - text 走 MessageContent 轻量 markdown；todos/diff/worked 各归其卡。
 */
export default function MessageList({ messages, onOpenFile, scrollRef }: MessageListProps) {
  void scrollRef;
  return (
    <div className="msg-list" data-testid="message-list">
      {messages.map((m) => {
        // 用户消息：右对齐气泡 + 底部（时间 + 复制）
        if (m.role === 'user') {
          const userText = messageText(m);
          return (
            <div className="msg user" key={m.id} data-testid="msg-user">
              <div className="bubble u">
                <MessageContent text={userText} />
                <MessageFooter ts={m.ts} text={userText} />
              </div>
            </div>
          );
        }

        // 系统消息：横幅样式
        if (m.role === 'system') {
          return (
            <div className="msg system" key={m.id} data-testid="msg-system">
              <div className="sys-banner">
                <MessageContent
                  text={m.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join('')}
                />
              </div>
            </div>
          );
        }

        // 助手消息：块序列（工具合并分组）+ 底部（时间 + 复制）
        const items = mergeAdjacentToolBlocks(m.blocks);
        return (
          <div className="msg assistant" key={m.id} data-testid="msg-assistant">
            <div className="msg-body">
              <div className="rich">
                {items.map((item, i) => (
                  <div className="msg-block" key={i}>
                    {renderBlock(item, onOpenFile)}
                  </div>
                ))}
              </div>
              <MessageFooter ts={m.ts} text={messageText(m)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
