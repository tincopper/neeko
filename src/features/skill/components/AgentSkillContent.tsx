import { Bot, FolderOpen, Loader2, Plus, Terminal } from 'lucide-react';
import React, { useEffect, useMemo, useState, useCallback } from 'react';

import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import { useNotificationStore } from '@/features/notification/notificationStore';
import { getAgentSkills, importSkillToAgent } from '@/features/skill/api/skillApi';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';
import type { AgentSkillGroup, ManagedSkillDto } from '@/shared/types';

interface AgentSkillContentProps {
  setDialog: (state: import('./skillItemTypes').SkillDialogState) => void;
}

const AgentSkillContent: React.FC<AgentSkillContentProps> = React.memo(({ setDialog }) => {
  const activeAgentId = useSkillStore((s) => s.activeAgentId);
  const skills = useSkillStore((s) => s.skills);
  const toast = useNotificationStore((s) => s.addNotification);

  const [groups, setGroups] = useState<AgentSkillGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    getAgentSkills()
      .then((data) => {
        setGroups(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const activeGroup = useMemo(
    () => groups.find((g) => g.agent_id === activeAgentId) ?? null,
    [groups, activeAgentId],
  );

  // Skills already in this agent (by name) — for dedup in Import
  const existingNames = useMemo(
    () => new Set(activeGroup?.skills.map((s) => s.name) ?? []),
    [activeGroup],
  );

  // Library skills not yet imported to this agent
  const importableSkills = useMemo(
    () => skills.filter((s) => !existingNames.has(s.name)),
    [skills, existingNames],
  );

  const handleImport = useCallback(
    async (skill: ManagedSkillDto) => {
      if (!activeAgentId) return;
      setImporting(true);
      try {
        await importSkillToAgent(skill.id, activeAgentId);
        toast({
          type: 'success',
          title: 'Imported',
          message: `"${skill.name}" → ${activeGroup?.agent_name}`,
        });
        await reload();
      } catch (e) {
        toast({ type: 'error', title: 'Import failed', message: String(e) });
      } finally {
        setImporting(false);
      }
    },
    [activeAgentId, activeGroup, reload, toast],
  );

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-32 text-text-muted"
        data-testid="agent-skill-loading"
      >
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!activeGroup) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-text-muted gap-2">
        <Bot className="h-8 w-8" />
        <p className="text-sm">Select an agent from the sidebar.</p>
      </div>
    );
  }

  const icon = resolveAgentIconSrc(activeGroup.agent_icon);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="flex items-center gap-2.5 h-11 px-4 border-b border-border">
          {icon ? (
            <img src={icon} alt="" className="h-5 w-5 rounded shrink-0" />
          ) : (
            <Terminal className="h-4 w-4 text-text-secondary shrink-0" />
          )}
          <h2 className="text-sm font-semibold text-text-primary">{activeGroup.agent_name}</h2>
          {!activeGroup.agent_enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700 font-medium">
              disabled
            </span>
          )}
          <span className="text-xs text-text-muted ml-auto">
            {activeGroup.skills.length} {activeGroup.skills.length === 1 ? 'skill' : 'skills'}
          </span>
          {activeGroup.agent_skill_path && (
            <span
              className="text-[10px] text-text-muted truncate max-w-[180px]"
              title={activeGroup.agent_skill_path}
            >
              {activeGroup.agent_skill_path}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar p-4">
        {activeGroup.skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted gap-2">
            <FolderOpen className="h-8 w-8" />
            <p className="text-sm">No skills found in this agent&apos;s directory.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {activeGroup.skills.map((diskSkill) => (
              <div
                key={diskSkill.path}
                className={cn(
                  'rounded-xl border p-3.5 flex flex-col gap-2.5 min-h-[120px]',
                  diskSkill.managed
                    ? 'border-border bg-bg-primary'
                    : 'border-dashed border-border/60 bg-bg-hover/30',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-text-primary truncate">
                    {diskSkill.name}
                  </h3>
                  {diskSkill.managed ? (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800/50 font-medium">
                      managed
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-800/50 font-medium">
                      local
                    </span>
                  )}
                </div>

                {diskSkill.description && (
                  <p className="text-xs text-text-muted line-clamp-2">{diskSkill.description}</p>
                )}

                <p className="text-[10px] text-text-muted truncate mt-auto" title={diskSkill.path}>
                  {diskSkill.path}
                </p>

                {diskSkill.managed &&
                  diskSkill.skill_id &&
                  (() => {
                    const libSkill = skills.find((s) => s.id === diskSkill.skill_id);
                    return libSkill ? (
                      <button
                        type="button"
                        onClick={() => {
                          const libSkill = skills.find((s) => s.id === diskSkill.skill_id);
                          if (libSkill) setDialog({ type: 'view', skill: libSkill });
                        }}
                        className="self-start text-[10px] font-medium text-accent hover:text-accent-hover transition-colors"
                      >
                        View in Library
                      </button>
                    ) : null;
                  })()}
              </div>
            ))}
          </div>
        )}

        {/* Import from Library */}
        {importableSkills.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Plus className="h-3 w-3" />
              Import from Library
            </h3>
            <div className="flex flex-wrap gap-2">
              {importableSkills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  disabled={importing}
                  onClick={() => handleImport(skill)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    'border border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  <Plus className="h-3 w-3" />
                  {skill.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

AgentSkillContent.displayName = 'AgentSkillContent';

export default AgentSkillContent;
