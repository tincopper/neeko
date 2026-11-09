import React from 'react';

import FallbackImage from '@/shared/components/FallbackImage';

import { resolveAgentIconSrc } from '../api/agentApi';

export interface AgentIconProps {
  /** agent 配置里的图标标识：preset 文件名或用户上传路径；`null` = 兜底。 */
  icon?: string | null;
  /** 边长（px）；仅在未传 `className` 时生效。 */
  size?: number;
  /** 尺寸类覆盖 —— 传了就是调用方完全控制盒子。 */
  className?: string;
  alt?: string;
  title?: string;
  /**
   * 无图标 / 加载失败时的兜底内容。默认 `null`（不渲染）—— 保持现状，
   * 需要 Terminal glyph 的调用点显式传（`AgentRailRow` / `AgentSkillContent`）。
   */
  fallback?: React.ReactNode;
  testId?: string;
}

/**
 * agent 域唯一的图标容器：`icon` 标识 → 解析（preset / `convertFileSrc`）→ 展示。
 *
 * 解析需要 Tauri 边界（自定义上传图标走 `convertFileSrc`），所以容器住
 * `features/agent`；纯展示的 `<img>` + 加载失败兜底收敛在 `shared/FallbackImage`。
 */
function AgentIcon({ icon, size = 16, className, alt, title, fallback, testId }: AgentIconProps) {
  const src = resolveAgentIconSrc(icon);
  // 字符串兜底包一层 `<span>`，保持既有调用方（`"&#9889;"` / `"?"`）的行为。
  const fallbackNode = typeof fallback === 'string' ? <span>{fallback}</span> : (fallback ?? null);
  return (
    <FallbackImage
      src={src}
      size={size}
      className={className}
      alt={alt}
      title={title}
      testId={testId}
      fallback={fallbackNode}
    />
  );
}

export default React.memo(AgentIcon);
