import { Rotate3d } from 'lucide-react';

import { AgentIcon } from '@/features/agent';

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
  void id;
  return (
    <AgentIcon
      icon={icon}
      size={16}
      className="agent-badge-img"
      alt={name}
      fallback={
        <span className="model-opt-icon">
          <Rotate3d size={14} />
        </span>
      }
    />
  );
}

export { AgentBadge };
