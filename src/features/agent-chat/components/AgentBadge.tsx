import { Rotate3d } from 'lucide-react';
import { useState } from 'react';

import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';

/**
 * Agent 图标徽标：有 icon 渲染 CLI 真实图标；无 icon（或加载失败）统一
 * 降级为 lucide Rotate3d 图标（保持下拉视觉统一）。
 */
function AgentBadge({
  icon,
  name,
  id,
}: {
  icon: string | null | undefined;
  name: string;
  id: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = resolveAgentIconSrc(icon);
  if (src && !broken) {
    return (
      <img
        className="agent-badge-img"
        src={src}
        width={16}
        height={16}
        alt={name}
        onError={() => setBroken(true)}
      />
    );
  }
  void id;
  return (
    <span className="model-opt-icon">
      <Rotate3d size={14} />
    </span>
  );
}

export { AgentBadge };
