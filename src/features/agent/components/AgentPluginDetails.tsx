/**
 * AgentPluginDetails — expanded view of an AgentPlugin contract.
 *
 * Shows: execution, configuration, capabilities, paths, lifecycle.
 */

import React from 'react';

import { cn } from '@/lib/utils';
import type { AgentPlugin } from '@/shared/types/agentPlugin';
import { getAgentIconSrc } from '@/shared/utils/agents';

import { resolveAgentIconSrc } from '../api/agentApi';

interface AgentPluginDetailsProps {
  plugin: AgentPlugin;
  resolvedPaths?: Record<string, string>;
}

/** Section header for detail groups. */
const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
  <div className="text-[0.79em] font-semibold text-text-secondary mt-3 mb-1.5 uppercase tracking-wider">
    {title}
  </div>
);

/** Key-value row. */
const DetailRow: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start gap-2 py-0.5 text-[0.82em]">
    <span className="text-text-muted min-w-[80px] shrink-0">{label}:</span>
    <span className="text-text-primary break-all">{value ?? '—'}</span>
  </div>
);

const AgentPluginDetails: React.FC<AgentPluginDetailsProps> = ({ plugin, resolvedPaths }) => {
  const iconSrc = resolveAgentIconSrc(plugin.icon) ?? getAgentIconSrc(plugin.icon);

  return (
    <div className="flex flex-col gap-2 p-3 text-[0.86em]">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        {iconSrc ? (
          <img src={iconSrc} className="w-7 h-7 object-contain" alt="" />
        ) : (
          <span className="w-7 h-7" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-text-primary font-semibold">{plugin.name}</div>
          {plugin.description && (
            <div className="text-text-muted text-[0.82em]">{plugin.description}</div>
          )}
        </div>
        <span
          className={cn(
            'text-[0.72em] px-1.5 py-0.5 rounded shrink-0',
            plugin.isBuiltin
              ? 'bg-accent-blue/10 text-accent-blue'
              : 'bg-bg-secondary text-text-muted',
          )}
        >
          {plugin.isBuiltin ? 'Built-in' : 'Custom'}
        </span>
      </div>

      {/* Execution */}
      <SectionHeader title="Execution" />
      <DetailRow label="Command" value={<code>{plugin.execution.command}</code>} />
      {plugin.execution.args.length > 0 && (
        <DetailRow label="Args" value={<code>{plugin.execution.args.join(' ')}</code>} />
      )}
      {plugin.execution.promptArgs && plugin.execution.promptArgs.length > 0 && (
        <DetailRow
          label="Prompt Args"
          value={<code>{plugin.execution.promptArgs.join(' ')}</code>}
        />
      )}
      {plugin.execution.detection && (
        <DetailRow
          label="Detection"
          value={`${plugin.execution.detection.type}: ${plugin.execution.detection.target}`}
        />
      )}

      {/* Capabilities */}
      <SectionHeader title="Capabilities" />
      <div className="flex flex-wrap gap-1.5">
        {(['skills', 'mcp', 'commands', 'hooks', 'plugins'] as const).map((cap) => {
          const capDef = plugin.capabilities[cap];
          const supported =
            capDef &&
            typeof capDef === 'object' &&
            'supported' in capDef &&
            (capDef as { supported: boolean }).supported;
          return (
            <span
              key={cap}
              className={cn(
                'text-[0.72em] px-1.5 py-0.5 rounded',
                supported ? 'bg-green-500/10 text-green-400' : 'bg-bg-secondary text-text-muted/50',
              )}
            >
              {cap}
            </span>
          );
        })}
      </div>

      {/* Paths */}
      <SectionHeader title="Resource Paths" />
      {(
        [
          ['config', plugin.paths.config],
          ['skills', plugin.paths.skills],
          ['commands', plugin.paths.commands],
          ['mcp', plugin.paths.mcp],
          ['hooks', plugin.paths.hooks],
          ['plugins', plugin.paths.plugins],
        ] as const
      ).map(([key, tpl]) => (
        <DetailRow
          key={key}
          label={key}
          value={
            <span className="flex items-center gap-1">
              <code className="text-[0.78em]">{tpl.relative}</code>
              {tpl.projectLevel && (
                <span className="text-[0.68em] text-accent-blue shrink-0">project</span>
              )}
              {resolvedPaths?.[key] && (
                <span className="text-[0.68em] text-text-muted shrink-0">
                  → {resolvedPaths[key]}
                </span>
              )}
            </span>
          }
        />
      ))}

      {/* Lifecycle */}
      {plugin.lifecycle && (
        <>
          <SectionHeader title="Lifecycle" />
          {plugin.lifecycle.onProjectActivate && (
            <DetailRow label="onActivate" value={plugin.lifecycle.onProjectActivate} />
          )}
          {plugin.lifecycle.onSessionStart && (
            <DetailRow label="onSessionStart" value={plugin.lifecycle.onSessionStart} />
          )}
        </>
      )}
    </div>
  );
};

export default React.memo(AgentPluginDetails);
