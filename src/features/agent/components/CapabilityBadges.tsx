/**
 * CapabilityBadges — Agent 能力徽标（CLI / CHAT / Headless）。
 *
 * CLI/CHAT/Headless 是三个正交能力（不是并列形态）：
 * - CLI：`command` 非空（终端 Tab + PTY 跑 agent 自带 TUI）；
 * - CHAT：`chat: Some(_)`（Agent Chat Tab + adapter 驱动）；
 * - Headless：`prompt_args`（程序化单轮，如 AI commit）。
 *
 * 配色沿用 Catppuccin Mocha 语义色：CLI=blue、CHAT=green、Headless=yellow。
 */

import React from 'react';

import { cn } from '@/lib/utils';
import { agentCapabilities, type AgentConfig } from '@/shared/types/agent';

export type CapabilityKind = 'cli' | 'chat' | 'headless';

export const CAPABILITY_META: Record<CapabilityKind, { label: string; cls: string; dot: string }> =
  {
    cli: {
      label: 'CLI',
      cls: 'text-accent-blue border-accent-blue/25 bg-accent-blue/10',
      dot: 'bg-accent-blue',
    },
    chat: {
      label: 'CHAT',
      cls: 'text-accent-green border-accent-green/25 bg-accent-green/10',
      dot: 'bg-accent-green',
    },
    headless: {
      label: 'Headless',
      cls: 'text-accent-yellow border-accent-yellow/25 bg-accent-yellow/10',
      dot: 'bg-accent-yellow',
    },
  };

/** 单枚能力徽标。 */
function CapChip({ kind, className }: { kind: CapabilityKind; className?: string }) {
  const meta = CAPABILITY_META[kind];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-px text-[0.68em] font-medium leading-[1.5]',
        meta.cls,
        className,
      )}
    >
      <span className={cn('size-[5px] rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

interface CapabilityBadgesProps {
  agent: Pick<AgentConfig, 'command' | 'chat' | 'prompt_args'>;
  className?: string;
}

/** 一组能力徽标（有哪个能力显示哪个）。 */
const CapabilityBadges: React.FC<CapabilityBadgesProps> = ({ agent, className }) => {
  const caps = agentCapabilities(agent as AgentConfig);
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {caps.cli && <CapChip kind="cli" />}
      {caps.chat && <CapChip kind="chat" />}
      {caps.headless && <CapChip kind="headless" />}
    </span>
  );
};

export default React.memo(CapabilityBadges);
