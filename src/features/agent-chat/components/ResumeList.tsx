import { MessageSquare } from 'lucide-react';
import { memo } from 'react';

import type { ConversationMeta } from '@/shared/types/session';

interface ResumeListProps {
  items: ConversationMeta[];
  loading: boolean;
  onRestore: (meta: ConversationMeta) => void;
}

const formatTime = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * 空会话态的「最近会话」列表体 —— 数据来自 conversation 域扫描
 * （agent 原生存储，跨 agent 汇总）。折叠开关由 wa-sys 状态栏行内的
 * 「恢复上次对话」按钮控制（见 AgentChatTabView），本组件仅渲染列表。
 */
const ResumeList = memo(function ResumeList({ items, loading, onRestore }: ResumeListProps) {
  return (
    <div className="resume-list" id="resume-list" data-testid="resume-list">
      <div className="resume-list-body">
        {loading ? (
          <div className="resume-list-empty">正在加载最近会话…</div>
        ) : items.length === 0 ? (
          <div className="resume-list-empty">暂无可恢复的历史会话</div>
        ) : (
          items.map((c) => (
            <button
              key={c.id}
              type="button"
              className="resume-item"
              onClick={() => c.nativeSessionId && onRestore(c)}
              disabled={!c.nativeSessionId}
              title={c.preview}
            >
              <MessageSquare size={14} className="resume-item-icon" />
              <span className="resume-item-agent">{c.agentId}</span>
              <span className="resume-item-title">{c.userTitle ?? c.title}</span>
              <span className="resume-item-meta">
                {c.messageCount} 条 · {formatTime(c.updatedAt)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
});

export default ResumeList;
