/**
 * AgentPluginCard — compact card displaying an AgentPlugin summary.
 *
 * Shows: icon, name, description, capabilities badges, install status.
 */

import React from 'react';

import { cn } from '@/lib/utils';
import type { AgentPlugin } from '@/shared/types/agentPlugin';
import { getAgentIconSrc } from '@/shared/utils/agents';

import { resolveAgentIconSrc } from '../api/agentApi';

interface AgentPluginCardProps {
  plugin: AgentPlugin;
  installed?: boolean;
  isSelected?: boolean;
  onClick?: (plugin: AgentPlugin) => void;
}

const CAPABILITY_BADGES: { key: string; label: string }[] = [
  { key: 'skills', label: 'Skills' },
  { key: 'mcp', label: 'MCP' },
  { key: 'commands', label: 'Cmds' },
  { key: 'hooks', label: 'Hooks' },
  { key: 'plugins', label: 'Ext' },
];

const AgentPluginCard: React.FC<AgentPluginCardProps> = ({
  plugin,
  installed,
  isSelected,
  onClick,
}) => {
  const iconSrc = resolveAgentIconSrc(plugin.icon) ?? getAgentIconSrc(plugin.icon);

  const supportedCaps = CAPABILITY_BADGES.filter(
    ({ key }) => plugin.capabilities[key as keyof typeof plugin.capabilities],
  );

  return (
    <button
      type="button"
      className={cn(
        'flex flex-col gap-1.5 p-2.5 rounded-lg border text-left transition-colors duration-150',
        'hover:bg-bg-hover hover:border-border',
        isSelected ? 'border-accent-blue bg-accent-blue/5' : 'border-border bg-bg-primary',
      )}
      onClick={() => onClick?.(plugin)}
    >
      <div className="flex items-center gap-2">
        {iconSrc ? (
          <img src={iconSrc} className="w-[18px] h-[18px] object-contain shrink-0" alt="" />
        ) : (
          <span className="w-[18px] h-[18px] shrink-0" />
        )}
        <span className="text-[0.86em] text-text-primary font-medium truncate">{plugin.name}</span>
        {installed !== undefined && (
          <span
            className={cn(
              'ml-auto text-[0.68em] font-medium px-1.5 py-0.5 rounded-full shrink-0',
              installed ? 'bg-green-500/10 text-green-400' : 'bg-bg-secondary text-text-muted',
            )}
            title={installed ? 'Installed' : 'Not installed'}
          >
            {installed ? '●' : '○'}
          </span>
        )}
      </div>

      {plugin.description && (
        <span className="text-[0.75em] text-text-muted line-clamp-2 leading-snug">
          {plugin.description}
        </span>
      )}

      {supportedCaps.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {supportedCaps.map(({ key, label }) => (
            <span
              key={key}
              className="text-[0.65em] px-1.5 py-0.5 rounded bg-bg-secondary text-text-muted"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
};

export default React.memo(AgentPluginCard);
