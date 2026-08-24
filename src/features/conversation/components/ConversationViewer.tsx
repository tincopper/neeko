import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  PanelRight,
  Search,
  SquareTerminal,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AgentIcon } from '@/features/agent';
import type { AgentConfig } from '@/features/agent/types';
import { cn } from '@/lib/utils';
import { VirtualList, type VirtualListHandle } from '@/shared/components/VirtualList';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { useProjectStore } from '@/shared/store/projectStore';
import { Button } from '@/ui/Button';

import { getConversationMessages, exportConversation } from '../api/conversationApi';
import { useConversationSearch } from '../hooks/useConversationSearch';
import type { ConversationMessage as ConversationMessageType, ConversationMeta } from '../types';
import { messageToText } from '../utils/messageToText';
import { getToolSummary } from '../utils/toolPresentation';

import ConversationMessage from './ConversationMessage';
import { MessageBlockList, ToolIcon } from './MessageBlocks';
import MessageBubble from './MessageBubble';

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

function groupMessages(messages: ConversationMessageType[], startIdx: number): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const actualIdx = startIdx + i;
    if (msg.role !== 'assistant') {
      groups.push({
        role: msg.role as 'user' | 'assistant',
        messages: [msg],
        indices: [actualIdx],
      });
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

const ConversationViewer: React.FC<ConversationViewerProps> = React.memo(
  ({ conversationId, agentId, conversationMeta, agents = [], onBack, onResume, showToast }) => {
    const [messages, setMessages] = useState<ConversationMessageType[]>([]);
    const [loading, setLoading] = useState(true);
    const [displayCount, setDisplayCount] = useState(INITIAL_LOAD);
    const [exporting, setExporting] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [atTop, setAtTop] = useState(true);
    const [copiedGroup, setCopiedGroup] = useState<number | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const listHandleRef = useRef<VirtualListHandle | null>(null);
    const copyToClipboard = useCopyToClipboard();

    const search = useConversationSearch(messages);

    const handleCopyGroup = useCallback(
      async (msgs: ConversationMessageType[], firstIdx: number) => {
        const text = msgs
          .map((m) => messageToText(m))
          .filter(Boolean)
          .join('\n\n');
        if (!text) return;
        const ok = await copyToClipboard(text, 'message');
        if (ok) {
          setCopiedGroup(firstIdx);
          window.setTimeout(() => setCopiedGroup(null), 1500);
        }
      },
      [copyToClipboard],
    );

    const agent = useMemo(() => agents.find((a) => a.id === agentId) ?? null, [agents, agentId]);

    // Project avatar for user messages — falls back to Neeko icon when no active project.
    const activeProject = useProjectStore((s) => s.activeProject);
    const projectName = activeProject?.name ?? null;
    const projectColor = activeProject?.avatar_color ?? null;

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

    // Track scroll position for nav button
    const handleScroll = useCallback((scrollTop: number) => {
      setAtTop(scrollTop < 60);
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

    // Jump to bottom on first load (instant — smooth animation janks on long transcripts)
    useEffect(() => {
      if (!loading && messages.length > 0 && groups.length > 0) {
        listHandleRef.current?.scrollToIndex(groups.length - 1, 'end');
      }
    }, [loading, messages.length, groups.length]);

    const handleLoadMore = useCallback(() => {
      const prevHeight = listHandleRef.current?.getScrollElement()?.scrollHeight ?? 0;
      setDisplayCount((prev) => prev + LOAD_MORE);
      requestAnimationFrame(() => {
        const el = listHandleRef.current?.getScrollElement();
        if (el) {
          el.scrollTop = el.scrollHeight - prevHeight;
        }
      });
    }, []);

    const handleExport = useCallback(async () => {
      setExporting(true);
      try {
        const markdown = await exportConversation(conversationId);
        const ok = await copyToClipboard(markdown, 'conversation');
        if (ok) showToast?.('Conversation exported to clipboard', 'info');
      } catch (err) {
        console.error('[ConversationViewer] Export failed:', err);
        showToast?.('Failed to export conversation', 'error');
      } finally {
        setExporting(false);
      }
    }, [conversationId, showToast, copyToClipboard]);

    const scrollToMessage = useCallback(
      (msgIdx: number) => {
        const groupIdx = groups.findIndex((g) => g.indices.includes(msgIdx));
        if (groupIdx >= 0) {
          listHandleRef.current?.scrollToIndex(groupIdx, 'center');
        }
      },
      [groups],
    );

    const scrollToTop = useCallback(() => {
      listHandleRef.current?.getScrollElement()?.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const scrollToBottom = useCallback(() => {
      listHandleRef.current?.scrollToIndex(groups.length - 1, 'end');
    }, [groups.length]);

    // 搜索导航：当前匹配变化时滚动到对应消息
    useEffect(() => {
      if (search.current >= 0) {
        scrollToMessage(search.current);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- search 为自定义 hook 返回对象，仅需监听 current 变化
    }, [search.current, scrollToMessage]);

    const agentName = agent?.name ?? agentId ?? 'Conversation';
    const modelLabel = conversationMeta?.model;
    // Prefer the conversation title (matches the History list row); fall back to agent name.
    const title =
      conversationMeta?.userTitle?.trim() || conversationMeta?.title?.trim() || agentName;

    return (
      <div className="flex flex-col h-full overflow-hidden bg-bg-secondary">
        {/* Toolbar — mirrors History panel header: flat bg, title + muted meta, icon actions */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-text-muted hover:text-text-primary"
            onClick={onBack}
            title="Back to history"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>

          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-text-primary truncate leading-tight">
              {title}
            </h3>
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted min-w-0">
              {agent ? (
                <span className="shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                  <AgentIcon icon={agent.icon} size={12} />
                </span>
              ) : null}
              <span className="truncate">{agentName}</span>
              {modelLabel ? (
                <>
                  <span className="shrink-0">·</span>
                  <span className="truncate font-mono text-[10px]">{modelLabel}</span>
                </>
              ) : null}
              {!loading && messages.length > 0 ? (
                <>
                  <span className="shrink-0">·</span>
                  <span className="shrink-0 tabular-nums">{stats.totalMessages} msgs</span>
                  {stats.toolCalls > 0 ? (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0 tabular-nums">{stats.toolCalls} tools</span>
                    </>
                  ) : null}
                  {stats.thinkingCount > 0 ? (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0 tabular-nums">{stats.thinkingCount} thinking</span>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            {searchOpen ? (
              <div className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md border border-border bg-bg-secondary/60 mr-1">
                <input
                  ref={(el) => el?.focus()}
                  type="text"
                  value={search.query}
                  onChange={(e) => search.setQuery(e.target.value)}
                  placeholder="Search messages…"
                  aria-label="Search messages"
                  className="w-40 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted/60"
                />
                {search.matches.length > 0 ? (
                  <span
                    className="shrink-0 text-[10px] text-text-muted tabular-nums"
                    data-testid="search-count"
                  >
                    {search.activeIndex + 1} / {search.matches.length}
                  </span>
                ) : search.query ? (
                  <span className="shrink-0 text-[10px] text-text-muted/60">0 / 0</span>
                ) : null}
                <button
                  type="button"
                  className="p-1 rounded-md text-text-muted hover:text-text-primary transition-colors"
                  onClick={search.goToPrev}
                  title="Previous match"
                  aria-label="Previous match"
                  disabled={search.matches.length === 0}
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  className="p-1 rounded-md text-text-muted hover:text-text-primary transition-colors"
                  onClick={search.goToNext}
                  title="Next match"
                  aria-label="Next match"
                  disabled={search.matches.length === 0}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  className="p-1 rounded-md text-text-muted hover:text-text-primary transition-colors"
                  onClick={() => {
                    search.clear();
                    setSearchOpen(false);
                  }}
                  title="Close search"
                  aria-label="Close search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 text-text-muted hover:text-text-primary"
                onClick={() => setSearchOpen(true)}
                title="Search in conversation"
                aria-label="Search in conversation"
              >
                <Search className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'w-7 h-7 text-text-muted hover:text-text-primary',
                sidebarOpen && 'bg-bg-hover text-accent-blue hover:text-accent-blue',
              )}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title="Toggle tool call sidebar"
            >
              <PanelRight className="w-3.5 h-3.5" />
            </Button>
            {conversationMeta && onResume && conversationMeta.supportsResume === true ? (
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 text-text-muted hover:text-accent-green hover:bg-accent-green/10"
                onClick={() => onResume(conversationMeta)}
                title="Resume"
              >
                <SquareTerminal className="w-3.5 h-3.5" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-text-muted hover:text-text-primary"
              onClick={handleExport}
              disabled={exporting}
              title={exporting ? 'Exporting…' : 'Export to clipboard'}
            >
              <Download className={cn('w-3.5 h-3.5', exporting && 'animate-pulse')} />
            </Button>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Messages */}
          <div className="flex-1 flex flex-col min-w-0">
            {hasMore && (
              <div className="flex justify-center pt-2 pb-1 shrink-0">
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
            {loading ? (
              <div className="flex items-center justify-center py-16 text-xs text-text-secondary/40">
                Loading...
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-xs text-text-secondary/40">
                No messages in this conversation
              </div>
            ) : (
              <VirtualList
                className="flex-1"
                items={groups}
                getKey={(g) => g.indices[0]}
                estimateSize={96}
                overscan={6}
                handleRef={listHandleRef}
                onScroll={handleScroll}
                renderItem={(group) => {
                  const firstIdx = group.indices[0];
                  if (group.role === 'assistant') {
                    const firstMsg = group.messages[0];
                    return (
                      <div data-group-row className="max-w-3xl mx-auto px-4">
                        <MessageBubble
                          kind="assistant"
                          label={agent?.name ?? agentId ?? 'Assistant'}
                          icon={agent ? <AgentIcon icon={agent.icon} size={14} /> : undefined}
                          timestamp={firstMsg.timestamp}
                          model={firstMsg.model}
                          onCopy={() => handleCopyGroup(group.messages, firstIdx)}
                          copied={copiedGroup === firstIdx}
                        >
                          {/* Sub-messages */}
                          {group.messages.map((msg, msgIdx) => {
                            // 跳过无内容的消息
                            const hasAnyContent =
                              (msg.blocks && msg.blocks.length > 0) ||
                              (msg.content?.trim() ?? '').length > 0;
                            if (!hasAnyContent) return null;

                            // 切换模型提示：仅从第2条开始，且与前一条模型不同时展示
                            const showModel =
                              msgIdx > 0 &&
                              msg.model != null &&
                              msg.model !== group.messages[msgIdx - 1].model;
                            return (
                              <React.Fragment key={msg.seq}>
                                {showModel && (
                                  <span className="text-[10px] font-mono text-text-secondary/40 mb-1.5 block">
                                    ↳ {msg.model}
                                  </span>
                                )}
                                {msg.blocks && msg.blocks.length > 0 ? (
                                  <MessageBlockList
                                    blocks={msg.blocks}
                                    highlightQuery={search.query}
                                  />
                                ) : (
                                  <MessageBlockList
                                    blocks={[{ type: 'text', text: msg.content }]}
                                    highlightQuery={search.query}
                                  />
                                )}
                              </React.Fragment>
                            );
                          })}
                        </MessageBubble>
                      </div>
                    );
                  }

                  // user messages — render individually
                  return (
                    <div data-group-row className="max-w-3xl mx-auto px-4">
                      {group.messages.map((msg) => (
                        <ConversationMessage
                          key={msg.seq}
                          message={msg}
                          projectName={projectName}
                          projectColor={projectColor}
                          highlightQuery={search.query}
                        />
                      ))}
                    </div>
                  );
                }}
              />
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
                  const summary = getToolSummary(call.name, call.input);
                  return (
                    <button
                      key={idx}
                      type="button"
                      className="flex items-start gap-2 w-full px-2 py-1.5 text-xs hover:bg-bg-hover rounded transition-colors text-left"
                      onClick={() => scrollToMessage(call.msgIdx)}
                    >
                      <ToolIcon
                        name={call.name}
                        className="w-3.5 h-3.5 text-accent-blue shrink-0 mt-0.5"
                      />
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
