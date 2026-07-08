import React, { useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { useConversationList } from '../hooks/useConversationList';
import { useConversationResume } from '../hooks/useConversationResume';
import ConversationList from './ConversationList';
import type { ConversationMeta } from '../types';
import type { AgentConfig } from '@/features/agent/types';

interface ConversationPanelProps {
  projectPath: string | null;
  projectId: string | null;
  agents: AgentConfig[];
  isActive: boolean;
  showToast: (message: string, type?: 'info' | 'error') => void;
  onOpenConversationTab: (meta: ConversationMeta) => void;
  onResumeConversation: (meta: ConversationMeta) => Promise<void>;
}

const ConversationPanel: React.FC<ConversationPanelProps> = React.memo(({
  projectPath,
  projectId,
  agents,
  isActive,
  showToast,
  onOpenConversationTab,
  onResumeConversation,
}) => {
  const { conversations, loading, refresh } = useConversationList(projectPath, isActive);
  const { isResuming } = useConversationResume(projectId);

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleView = useCallback((meta: ConversationMeta) => {
    onOpenConversationTab(meta);
  }, [onOpenConversationTab]);

  const handleResume = useCallback(async (meta: ConversationMeta) => {
    if (isResuming) return;
    try {
      showToast(`Starting ${meta.agentId}...`, 'info');
      await onResumeConversation(meta);
      showToast('Resuming conversation...', 'info');
      // 延迟刷新，等 Agent 更新完 session 文件
      setTimeout(() => refresh(), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resume conversation';
      showToast(msg, 'error');
    }
  }, [isResuming, showToast, onResumeConversation, refresh]);

  if (!projectPath) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-medium text-text-primary">History</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-text-secondary/60">No project selected</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-medium text-text-primary">History</span>
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7"
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh conversations"
        >
          <RefreshCw className={cn('w-4 h-4', loading ? 'animate-spin' : '')} />
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        <ConversationList
          conversations={conversations}
          agents={agents}
          loading={loading}
          onView={handleView}
          onResume={handleResume}
        />
      </div>
    </div>
  );
});
ConversationPanel.displayName = 'ConversationPanel';

export default ConversationPanel;
