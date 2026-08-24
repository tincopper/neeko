import { useCallback, useMemo, useState } from 'react';

interface ProposedPlanCardProps {
  /** The proposed plan markdown text. */
  plan: string;
}

/// Character count above which a plan is considered "long" and collapsed by default.
const LONG_PLAN_CHARS = 900;

/**
 * Plan Mode 卡片 —— Agent 在 Plan Mode 下输出 `<proposed_plan>` 时渲染。
 * 长计划（>900字符）默认折叠，底部渐变 fade；支持展开/折叠与复制。
 */
export default function ProposedPlanCard({ plan }: ProposedPlanCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isLong = useMemo(() => plan.length > LONG_PLAN_CHARS, [plan]);

  const toggle = useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(plan);
  }, [plan]);

  return (
    <div className="plan-card" data-testid="proposed-plan-card">
      <div className="plan-header">
        <span className="plan-icon">📋</span>
        <span className="plan-title">Proposed Plan</span>
      </div>
      <div className={`plan-body${isLong && !expanded ? ' collapsed' : ''}`}>
        <div className="plan-content">{plan}</div>
        {isLong && !expanded && <div className="plan-fade" />}
      </div>
      <div className="plan-actions">
        {isLong && (
          <button type="button" className="plan-action" onClick={toggle}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
        <button type="button" className="plan-action" onClick={handleCopy}>
          Copy
        </button>
      </div>
    </div>
  );
}
