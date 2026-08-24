import { ChevronRight, MessageSquare, Plus } from 'lucide-react';
import { memo, useState } from 'react';

import type { ConversationMeta } from '@/shared/types/session';

interface ResumeListProps {
  items: ConversationMeta[];
  loading: boolean;
  onRestore: (meta: ConversationMeta) => void;
  /** 放弃恢复，从零新建会话。 */
  onNewSession: () => void;
}

const formatTime = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * 空会话态的「最近会话」恢复列表 —— 数据来自 conversation 域扫描
 * （agent 原生存储，跨 agent 汇总）。可折叠；点击条目恢复（agent/模型
 * 随之切换），「新建会话」放弃恢复从零开始。
 */
const ResumeList = memo(function ResumeList({
  items,
  loading,
  onRestore,
  onNewSession,
}: ResumeListProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="resume-list" data-testid="resume-list">
      <button
        type="button"
        className="resume-list-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <ChevronRight size={12} className={`resume-list-chevron${collapsed ? '' : ' open'}`} />
        <span className="resume-list-title">恢复上次对话</span>
        <span
          role="button"
          tabIndex={0}
          className="resume-new-btn"
          aria-label="新建会话"
          title="新建会话（不恢复历史）"
          onClick={(e) => {
            e.stopPropagation();
            onNewSession();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onNewSession();
            }
          }}
        >
          <Plus size={12} />
          新建会话
        </span>
      </button>

      {!collapsed && (
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
      )}
    </div>
  );
});

export default ResumeList;
