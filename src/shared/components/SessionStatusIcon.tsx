import React from 'react';

import { cn } from '@/lib/utils';
import type { SessionState } from '@/shared/types/liveSessions';

/**
 * 状态 → 视觉的**唯一映射表**。
 *
 * 两个投影（tab 前导点 / 侧栏会话行）都复用本组件的映射表 —— 谁要是自己写
 * `state === 'running' ? 'bg-accent-green' : …`，就多出第二张表，两处迟早颜色不一致。
 * 侧栏会话子行为了省窄行空间省略 ready / stopped（见 `SessionList`），tab 前导点仍按完整状态显示。
 *
 * 双通道表达（`<prototype.html>` 的「状态 → 视觉」）：
 * | 状态 | 形状 | 颜色 | 动 |
 * | --- | --- | --- | --- |
 * | running | 实心圆 | `--accent-green` | 呼吸环 |
 * | awaitingApproval | 菱形（旋转 45° 的方） | `--accent-yellow` | — |
 * | failed | 方 | `--status-failed` | — |
 * | ready | 空心圆 | `--text-muted` | — |
 * | stopped | 空心方 | `--text-muted`（降透明） | — |
 *
 * 形状是**第二个通道**：色觉障碍下五个状态仍然可区分（只靠颜色就等于只做了一个）。
 */

interface StatusVisual {
  /** 形状 / 配色 / 透明度（Tailwind token 类，不写死颜色）。 */
  className: string;
  /** 等待审批的菱形需要略微缩进，否则旋转后视觉上比其它状态大一圈。 */
  inset: number;
  /** 无障碍标签（`role="img"` 的 `aria-label`）。 */
  label: string;
}

const STATUS_VISUAL: Record<SessionState, StatusVisual> = {
  running: {
    className: 'rounded-full bg-accent-green live-dot-running',
    inset: 0,
    label: '运行中',
  },
  awaitingApproval: {
    className: 'rounded-[2px] bg-accent-yellow rotate-45',
    inset: 1,
    label: '等待审批',
  },
  failed: { className: 'rounded-[2px] bg-status-failed', inset: 0, label: '失败' },
  ready: { className: 'rounded-full border-[1.5px] border-text-muted', inset: 0, label: '就绪' },
  stopped: {
    className: 'rounded-[2px] border-[1.5px] border-text-muted opacity-45',
    inset: 0,
    label: '已停止',
  },
};

export interface SessionStatusIconProps {
  /** `null` / `undefined` = 该会话尚未注册（或单元里没有会话）⇒ **不画任何点**，不是灰点。 */
  status?: SessionState | null;
  /** 外径（px）。菱形会在内部缩 1px 做光学修正。 */
  size?: number;
  className?: string;
}

const SessionStatusIcon: React.FC<SessionStatusIconProps> = ({ status, size = 8, className }) => {
  if (!status) return null;
  const visual = STATUS_VISUAL[status];
  const box = Math.max(1, size - visual.inset);

  return (
    <span
      role="img"
      aria-label={visual.label}
      data-session-state={status}
      className={cn('inline-block shrink-0', visual.className, className)}
      style={{ width: box, height: box }}
    />
  );
};

export default React.memo(SessionStatusIcon);
