import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  File,
  Terminal,
  Search,
  Edit,
  Play,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { getConversationMessages, exportConversation } from '../api/conversationApi';
import ConversationMessage from './ConversationMessage';
import { MessageBlockRenderer } from './MessageBlocks';
import AgentIcon from '@/features/agent/components/AgentIcon';
import type { ConversationMessage as ConversationMessageType, ConversationMeta } from '../types';
import type { AgentConfig } from '@/features/agent/types';

interface ConversationViewerProps {
  conversationId: string;
  projectId?: string | null;
  agentId?: string;
  conversationMeta?: ConversationMeta | null;
  agents?: AgentConfig[];
  onBack: () => void;
  onResume?: (meta: ConversationMeta) => void;
  showToast?: (message: string, type?: 'info' | 'error') => void;
}

const INITIAL_LOAD = 100;
const LOAD_MORE = 50;

// 工具图标映射
const TOOL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Read: File,
  Write: Edit,
  Edit: Edit,
  Bash: Terminal,
  Grep: Search,
  Glob: Search,
};

// 工具调用侧边栏项
interface ToolCallItem {
  msgIdx: number;
  blockIdx: number;
  name: string;
  input: unknown;
}

interface MessageGroup {
  role: 'user' | 'assistant';
  messages: ConversationMessageType[];
  indices: number[];
}

// 提取工具摘要
function getToolSummary(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;

  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return (obj.file_path ?? obj.path ?? '') as string;
    case 'Bash':
      return (obj.command ?? '') as string;
    case 'Grep':
    case 'Glob':
      return (obj.pattern ?? '') as string;
    default:
      return '';
  }
}

function groupMessages(messages: ConversationMessageType[], startIdx: number): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const actualIdx = startIdx + i;
    if (msg.role !== 'assistant') {
      groups.push({ role: msg.role as 'user' | 'assistant', messages: [msg], indices: [actualIdx] });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.role === 'assistant') {
      last.messages.push(msg);
      last.indices.push(actualIdx);
    } else {
      groups.push({ role: 'assistant', messages: [msg], indices: [actualIdx] });
    }
  }
  return groups;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const ConversationViewer: React.FC<ConversationViewerProps> = React.memo(
  ({ conversationId, agentId, conversationMeta, agents = [], onBack, onResume, showToast }) => {
    const [messages, setMessages] = useState<ConversationMessageType[]>([]);
    const [loading, setLoading] = useState(true);
    const [displayCount, setDisplayCount] = useState(INITIAL_LOAD);
    const [exporting, setExporting] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [atTop, setAtTop] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const groupRefs = useRef<Map<number, HTMLDivElement>>(new Map());

    const agent = useMemo(
      () => agents.find((a) => a.id === agentId) ?? null,
      [agents, agentId],
    );

    // Load messages
    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setDisplayCount(INITIAL_LOAD);
      getConversationMessages(conversationId)
        .then((msgs) => {
          if (!cancelled) {
            setMessages(msgs);
            setLoading(false);
          }
        })
        .catch((err) => {
          console.error('[ConversationViewer] Failed to load messages:', err);
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [conversationId]);

    // Auto-scroll to bottom on first load
    useEffect(() => {
      if (!loading && messages.length > 0) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }, [loading, messages.length]);

    // Track scroll position for nav button
    const handleScroll = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      setAtTop(el.scrollTop < 60);
    }, []);

    // 计算统计信息和分组
    const stats = useMemo(() => {
      const toolCalls: ToolCallItem[] = [];
      let thinkingCount = 0;

      messages.forEach((msg, msgIdx) => {
        if (!msg.blocks) return;
        msg.blocks.forEach((block, blockIdx) => {
          if (block.type === 'toolUse') {
            toolCalls.push({
              msgIdx,
              blockIdx,
              name: block.name,
              input: block.input,
            });
          }
          if (block.type === 'thinking') {
            thinkingCount++;
          }
        });
      });

      const uniqueTools = [...new Set(toolCalls.map((tc) => tc.name))];

      return {
        totalMessages: messages.length,
        toolCalls: toolCalls.length,
        thinkingCount,
        uniqueTools,
        toolCallList: toolCalls,
      };
    }, [messages]);

    const visibleMessages = messages.slice(-displayCount);
    const visibleStartIdx = messages.length - displayCount;
    const hasMore = messages.length > displayCount;

    const groups = useMemo(
      () => groupMessages(visibleMessages, visibleStartIdx),
      [visibleMessages, visibleStartIdx],
    );

    const handleLoadMore = useCallback(() => {
      const prevHeight = scrollRef.current?.scrollHeight ?? 0;
      setDisplayCount((prev) => prev + LOAD_MORE);
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight;
        }
      });
    }, []);

    const handleExport = useCallback(async () => {
      setExporting(true);
      try {
        const markdown = await exportConversation(conversationId);
        await navigator.clipboard.writeText(markdown);
        showToast?.('Conversation exported to clipboard', 'info');
      } catch (err) {
        console.error('[ConversationViewer] Export failed:', err);
        showToast?.('Failed to export conversation', 'error');
      } finally {
        setExporting(false);
      }
    }, [conversationId, showToast]);

    const scrollToMessage = useCallback((msgIdx: number) => {
      const group = groups.find((g) => g.indices.includes(msgIdx));
      if (group) {
        const firstIdx = group.indices[0];
        const el = groupRefs.current.get(firstIdx);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, [groups]);

    const scrollToTop = useCallback(() => {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const scrollToBottom = useCallback(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    const agentName = agent?.name ?? agentId ?? 'Conversation';
    const modelLabel = conversationMeta?.model;

    return (
      <div className="flex flex-col h-full overflow-hidden bg-bg-primary">
        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary/50">
          <Button variant="ghost" size="icon" className="w-7 h-7" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {agent && (
                <AgentIcon icon={agent.icon} size={14} />
              )}
              <h3 className="text-sm font-medium text-text-primary truncate">
                {agentName}
              </h3>
              {modelLabel && (
                <span className="text-[11px] text-text-secondary/50 truncate">
                  · {modelLabel}
                </span>
              )}
            </div>
            {!loading && messages.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-text-secondary/50">
                <span>{stats.totalMessages} msgs</span>
                {stats.toolCalls > 0 && (
                  <>
                    <span>·</span>
                    <span>{stats.toolCalls} tools</span>
                  </>
                )}
                {stats.thinkingCount > 0 && (
                  <>
                    <span>·</span>
                    <span>{stats.thinkingCount} thinking</span>
                  </>
                )}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={cn('w-7 h-7', sidebarOpen && 'bg-bg-hover')}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Toggle tool call sidebar"
          >
            {sidebarOpen ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
          {conversationMeta && onResume && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-accent-green hover:text-accent-green hover:bg-accent-green/10"
              onClick={() => onResume(conversationMeta)}
            >
              <Play className="w-3 h-3" />
              Resume
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download className="w-3 h-3" />
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto"
            onScroll={handleScroll}
          >
            {loading ? (
              <div className="flex items-center justify-center py-16 text-xs text-text-secondary/40">
                Loading...
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-xs text-text-secondary/40">
                No messages in this conversation
              </div>
            ) : (
              <div className="max-w-3xl mx-auto py-4">
                {hasMore && (
                  <div className="flex justify-center pb-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-text-secondary/60"
                      onClick={handleLoadMore}
                    >
                      Load older messages
                    </Button>
                  </div>
                )}
                {groups.map((group) => {
                  const firstIdx = group.indices[0];
                  if (group.role === 'assistant') {
                    const firstMsg = group.messages[0];
                    const time = formatTime(firstMsg.timestamp);
                    return (
                      <div
                        key={`g-${firstIdx}`}
                        ref={(el) => {
                          if (el) groupRefs.current.set(firstIdx, el);
                        }}
                        className="flex gap-3 px-4 py-3 justify-start"
                      >
                        <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-bg-secondary text-text-primary rounded-bl-md border border-border/50">
                          {/* Role label + model */}
                          <div className="flex items-center gap-1.5 mb-2">
                            {agent && (
                              <AgentIcon icon={agent.icon} size={14} />
                            )}
                            <span className="text-[11px] font-medium text-green-400">
                              {agent?.name ?? agentId ?? 'Assistant'}
                            </span>
                            <span className="text-[11px] text-text-secondary/30 font-normal">
                              {time}
                            </span>
                            {firstMsg.model && (
                              <span className="text-[10px] font-mono text-text-secondary/40">
                                · {firstMsg.model}
                              </span>
                            )}
                          </div>

                          {/* Sub-messages */}
                          {group.messages.map((msg, msgIdx) => {
                            // 切换模型提示：仅从第2条开始，且与前一条模型不同时展示
                            const showModel = msgIdx > 0
                              && msg.model != null
                              && msg.model !== group.messages[msgIdx - 1].model;
                            return (
                              <React.Fragment key={msg.seq}>
                                {(msgIdx > 0 && (msg.blocks?.some((b) => {
                                  if (b.type === 'text') return b.text?.trim().length > 0;
                                  return true;
                                }) || msg.content?.trim().length > 0)) && (
                                  <div className="border-t border-border/50 my-2" />
                                )}
                                {showModel && (
                                  <span className="text-[10px] font-mono text-text-secondary/40 mb-1.5 block">
                                    ↳ {msg.model}
                                  </span>
                                )}
                                {msg.blocks && msg.blocks.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {msg.blocks.map((block, bIdx) => (
                                      <MessageBlockRenderer key={bIdx} block={block} />
                                    ))}
                                  </div>
                                ) : (
                                  <MessageBlockRenderer
                                    block={{ type: 'text', text: msg.content }}
                                  />
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  // user messages — render individually
                  return group.messages.map((msg) => (
                    <div
                      key={`${msg.seq}`}
                      ref={(el) => {
                        if (el) groupRefs.current.set(firstIdx, el);
                      }}
                    >
                      <ConversationMessage message={msg} />
                    </div>
                  ));
                })}
                <div ref={bottomRef} />
              </div>
            )}

          </div>

          {/* Navigation button (always visible, fixed at bottom-right) */}
          <Button
            variant="secondary"
            size="icon"
            className="absolute bottom-4 right-4 w-8 h-8 rounded-full shadow-md z-10"
            onClick={atTop ? scrollToBottom : scrollToTop}
            title={atTop ? 'Scroll to bottom' : 'Scroll to top'}
          >
            {atTop ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </Button>

          {/* Tool call sidebar */}
          {sidebarOpen && stats.toolCallList.length > 0 && (
            <div className="w-56 shrink-0 border-l border-border bg-bg-secondary/30 overflow-y-auto">
              <div className="p-2 text-[11px] font-medium text-text-secondary/60 border-b border-border">
                Tool Calls ({stats.toolCalls})
              </div>
              <div className="p-1">
                {stats.toolCallList.map((call, idx) => {
                  const Icon = TOOL_ICONS[call.name] ?? Terminal;
                  const summary = getToolSummary(call.name, call.input);
                  return (
                    <button
                      key={idx}
                      type="button"
                      className="flex items-start gap-2 w-full px-2 py-1.5 text-xs hover:bg-bg-hover rounded transition-colors text-left"
                      onClick={() => scrollToMessage(call.msgIdx)}
                    >
                      <Icon className="w-3.5 h-3.5 text-accent-blue shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="font-medium text-text-primary">{call.name}</div>
                        {summary && (
                          <div className="text-text-secondary/50 truncate text-[10px]">
                            {summary}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
);
ConversationViewer.displayName = 'ConversationViewer';

export default ConversationViewer;
