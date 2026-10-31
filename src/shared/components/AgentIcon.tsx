import React from 'react';

// eslint-disable-next-line import/no-restricted-paths -- shared component depends on agent icon resolution which is inherently in the agent feature
import { resolveAgentIconSrc } from '../../features/agent/api/agentApi';

interface AgentIconProps {
  icon?: string | null;
  size?: number;
  fallback?: string;
  /** 尺寸类覆盖（默认 16px）。侧栏会话行用更小的 13px，与行高对齐。 */
  className?: string;
}

const AgentIcon: React.FC<AgentIconProps> = ({ icon, size = 16, fallback = '', className }) => {
  const src = resolveAgentIconSrc(icon);
  if (src) {
    return (
      <img
        className={className ?? 'w-4 h-4 object-contain'}
        src={src}
        width={size}
        height={size}
        alt=""
      />
    );
  }
  return <span>{icon || fallback}</span>;
};

export default React.memo(AgentIcon);
