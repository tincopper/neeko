import { ShieldAlert, Undo2 } from 'lucide-react';

import type { PendingApproval } from '../types';
import { classifyDiffLine, isDiffLine } from '../utils/diffHighlight';

interface ApprovalPanelProps {
  pending: PendingApproval;
  onApprove: (allow: boolean) => void;
  onAllowSession: () => void;
  onCancelTurn: () => void;
}

function toolLabel(tool: string): string {
  if (tool === 'run_command' || tool === 'bash') return 'Bash';
  if (tool === 'edit_file') return 'Edit file';
  if (tool === 'write_file') return 'Write file';
  if (tool === 'read_file') return 'Read file';
  return tool.replaceAll('_', ' ');
}

/**
 * 内联审批面板 —— 严格对齐原型 `agent-chat-v2.html` 的 `.approval-panel`：
 * 标题 + 计数徽标 + mono 详情（diff/命令）+ 4 个编号选择。
 * 覆盖映射：Approve once → allow；Always allow this session → allow + 会话内自动放行；
 * Decline → deny；Cancel turn → 取消流。
 */
export default function ApprovalPanel({
  pending,
  onApprove,
  onAllowSession,
  onCancelTurn,
}: ApprovalPanelProps) {
  const isCommand = pending.tool === 'run_command' || pending.tool === 'bash' || !!pending.cmd;
  const title = isCommand ? 'Approve this command?' : 'Approve this change?';

  return (
    <div className="approval-panel" data-testid="approval-panel">
      <div className="approval-header">
        <div className="approval-title">
          <ShieldAlert size={14} style={{ color: 'var(--accent-yellow)', marginRight: 6 }} />
          {title}
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
            {toolLabel(pending.tool)}
          </span>
        </div>
        <div className="approval-count">
          {pending.index}/{pending.total}
        </div>
      </div>
      <div className="approval-detail">
        {pending.diff ? (
          <pre className="ap-pre">
            {pending.diff.split('\n').map((line, i) => {
              const kind = classifyDiffLine(line);
              return (
                <span key={i} className={`dl${isDiffLine(kind) ? ` ${kind}` : ''}`}>
                  {line}
                </span>
              );
            })}
          </pre>
        ) : (
          <code>{pending.cmd ?? pending.prompt}</code>
        )}
      </div>
      <div className="approval-actions">
        <button
          type="button"
          className="approval-choice choice-primary"
          onClick={() => onApprove(true)}
        >
          <div className="choice-num">1</div>
          <div>
            <div className="choice-label">Approve once</div>
            <div className="choice-desc">Allow just this request</div>
          </div>
        </button>
        <button type="button" className="approval-choice" onClick={onAllowSession}>
          <div className="choice-num">2</div>
          <div>
            <div className="choice-label">Always allow this session</div>
            <div className="choice-desc">Don&apos;t ask again this session</div>
          </div>
        </button>
        <button
          type="button"
          className="approval-choice choice-destructive"
          onClick={() => onApprove(false)}
        >
          <div className="choice-num">3</div>
          <div>
            <div className="choice-label">Decline</div>
            <div className="choice-desc">Reject and let the agent continue</div>
          </div>
        </button>
        <button type="button" className="approval-choice" onClick={onCancelTurn}>
          <div className="choice-num">4</div>
          <div>
            <div className="choice-label">
              <Undo2 size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
              Cancel turn
            </div>
            <div className="choice-desc">Stop the current turn</div>
          </div>
        </button>
      </div>
    </div>
  );
}
