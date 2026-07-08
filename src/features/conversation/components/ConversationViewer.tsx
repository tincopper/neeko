import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { Button } from '@/ui/button';
import { getConversationMessages, exportConversation } from '../api/conversationApi';
import ConversationMessage from './ConversationMessage';
import type { ConversationMessage as ConversationMessageType } from '../types';

interface ConversationViewerProps {
  conversationId: string;
  projectId?: string | null;
  agentId?: string;
  onBack: () => void;
  showToast?: (message: string, type?: 'info' | 'error') => void;
}

const INITIAL_LOAD = 100;
const LOAD_MORE = 50;

const ConversationViewer: React.FC<ConversationViewerProps> = React.memo(({
  conversationId,
  agentId,
  onBack,
  showToast,
}) => {
  const [messages, setMessages] = useState<ConversationMessageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayCount, setDisplayCount] = useState(INITIAL_LOAD);
  const [exporting, setExporting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    return () => { cancelled = true; };
  }, [conversationId]);

  // Auto-scroll to bottom on first load
  useEffect(() => {
    if (!loading && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [loading, messages.length]);

  const visibleMessages = messages.slice(-displayCount);
  const hasMore = messages.length > displayCount;

  const handleLoadMore = useCallback(() => {
    const prevHeight = scrollRef.current?.scrollHeight ?? 0;
    setDisplayCount((prev) => prev + LOAD_MORE);
    // Preserve scroll position after adding older messages at top
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

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-primary">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary/50">
        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-text-primary truncate">
            {agentId ?? 'Conversation'}
          </h3>
        </div>
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

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
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
                <Button variant="ghost" size="sm" className="text-xs text-text-secondary/60" onClick={handleLoadMore}>
                  Load older messages
                </Button>
              </div>
            )}
            {visibleMessages.map((msg, idx) => (
              <ConversationMessage key={`${msg.seq}-${idx}`} message={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
});
ConversationViewer.displayName = 'ConversationViewer';

export default ConversationViewer;
