import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, Play } from 'lucide-react';
import { Button } from '@/ui/button';
import { getConversationMessages, exportConversation } from '../api/conversationApi';
import { useConversationResume } from '../hooks/useConversationResume';
import ConversationMessage from './ConversationMessage';
import type { ConversationMessage as ConversationMessageType } from '../types';

interface ConversationViewerProps {
  conversationId: string;
  projectId: string | null;
  agentId?: string;
  onBack: () => void;
  showToast?: (message: string, type?: 'info' | 'error') => void;
}

const ConversationViewer: React.FC<ConversationViewerProps> = React.memo(({
  conversationId,
  projectId,
  agentId,
  onBack,
  showToast,
}) => {
  const [messages, setMessages] = useState<ConversationMessageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayCount, setDisplayCount] = useState(100);
  const [exporting, setExporting] = useState(false);

  const { isResuming } = useConversationResume(projectId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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

  const visibleMessages = messages.slice(0, displayCount);
  const hasMore = messages.length > displayCount;

  const handleLoadMore = useCallback(() => {
    setDisplayCount((prev) => prev + 100);
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

  // Resume in Viewer delegates to the main ConversationPanel's resume flow
  const handleResume = useCallback(() => {
    showToast?.('Click Resume on the History panel to resume this conversation', 'info');
  }, [showToast]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary">
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-text-primary truncate">
            Conversation
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {agentId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-accent-green hover:text-accent-green hover:bg-accent-green/10"
              onClick={handleResume}
              disabled={isResuming}
            >
              <Play className="w-3 h-3" />
              {isResuming ? 'Resuming...' : 'Resume'}
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
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-xs text-text-secondary/60">
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-text-secondary/60">
            No messages in this conversation
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border/50">
            {visibleMessages.map((msg, idx) => (
              <ConversationMessage key={`${msg.seq}-${idx}`} message={msg} />
            ))}
            {hasMore && (
              <div className="flex justify-center py-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={handleLoadMore}
                >
                  Load more ({messages.length - displayCount} remaining)
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
ConversationViewer.displayName = 'ConversationViewer';

export default ConversationViewer;
