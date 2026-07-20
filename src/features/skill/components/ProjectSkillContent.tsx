import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/ui';
import { useSkillStore } from '@/features/skill/store';
import { useProjectStore } from '@/features/project/store';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/features/notification/notificationStore';
import { getSkillsForTagGroup } from '@/features/skill/api/skillApi';
import type { ManagedSkillDto } from '@/shared/types';

/**
 * Project Skills — bind tag groups to the active project and apply (install-only).
 */
const ProjectSkillContent: React.FC = React.memo(() => {
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const activeProject = useProjectStore(s => s.activeProject);
  const tagGroups = useSkillStore(s => s.tagGroups);
  const projectTagGroups = useSkillStore(s => s.projectTagGroups);
  const projectBindingsLoading = useSkillStore(s => s.projectBindingsLoading);
  const applyingProjectId = useSkillStore(s => s.applyingProjectId);
  const loadProjectTagGroups = useSkillStore(s => s.loadProjectTagGroups);
  const setProjectTagGroups = useSkillStore(s => s.setProjectTagGroups);
  const applyProjectSkills = useSkillStore(s => s.applyProjectSkills);
  const refreshTagGroups = useSkillStore(s => s.refreshTagGroups);

  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [previewSkills, setPreviewSkills] = useState<ManagedSkillDto[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const toast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    useNotificationStore.getState().addNotification({
      type: type === 'error' ? 'error' : 'info',
      title: type === 'error' ? 'Error' : 'Project Skills',
      message,
    });
  }, []);

  useEffect(() => {
    void refreshTagGroups();
  }, [refreshTagGroups]);

  useEffect(() => {
    if (!activeProjectId) {
      setDraftIds([]);
      setDirty(false);
      setPreviewSkills([]);
      return;
    }
    void loadProjectTagGroups(activeProjectId)
      .then(() => {
        /* projectTagGroups updated in store */
      })
      .catch(e => toast(String(e), 'error'));
  }, [activeProjectId, loadProjectTagGroups, toast]);

  useEffect(() => {
    if (!dirty) {
      setDraftIds(projectTagGroups.map(g => g.id));
    }
  }, [projectTagGroups, dirty]);

  // Preview skills for selected (draft) tag groups
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (draftIds.length === 0) {
        setPreviewSkills([]);
        return;
      }
      try {
        const lists = await Promise.all(draftIds.map(id => getSkillsForTagGroup(id)));
        if (cancelled) return;
        const map = new Map<string, ManagedSkillDto>();
        for (const list of lists) {
          for (const s of list) map.set(s.id, s);
        }
        setPreviewSkills(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        if (!cancelled) setPreviewSkills([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [draftIds]);

  const boundSet = useMemo(() => new Set(draftIds), [draftIds]);

  const toggleGroup = useCallback((id: string) => {
    setDirty(true);
    setDraftIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeProjectId) return;
    setSaving(true);
    try {
      await setProjectTagGroups(activeProjectId, draftIds);
      setDirty(false);
      toast('Project tag groups saved');
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  }, [activeProjectId, draftIds, setProjectTagGroups, toast]);

  const handleApply = useCallback(async () => {
    if (!activeProjectId) return;
    setSaving(true);
    try {
      if (dirty) {
        await setProjectTagGroups(activeProjectId, draftIds);
        setDirty(false);
      }
      await applyProjectSkills(activeProjectId);
      toast('Skills applied to agents (install only)');
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  }, [activeProjectId, dirty, draftIds, setProjectTagGroups, applyProjectSkills, toast]);

  if (!activeProjectId || !activeProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3 bg-bg-secondary">
        <FolderOpen className="h-12 w-12 opacity-30" />
        <span className="text-sm">No project selected</span>
        <span className="text-xs max-w-xs text-center">
          Select a project in the sidebar to bind tag groups. Skills from those groups will be
          installed into agent skill directories when you open the project.
        </span>
      </div>
    );
  }

  const isApplying = applyingProjectId === activeProjectId || saving;

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-text-primary">Project Skills</span>
          <p className="text-xs text-text-muted truncate mt-0.5">
            {activeProject.name}
            <span className="text-text-muted/70"> · install only on switch</span>
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={!dirty || isApplying}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs gap-1"
            disabled={isApplying || draftIds.length === 0}
            onClick={() => void handleApply()}
          >
            {isApplying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Apply now
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <section>
          <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2">
            Bound tag groups
          </h3>
          {projectBindingsLoading ? (
            <div className="flex items-center gap-2 text-text-muted text-xs py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : tagGroups.length === 0 ? (
            <p className="text-xs text-text-muted">
              No tag groups yet. Create one in the Skills sidebar (e.g. Backend, Frontend).
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tagGroups.map(tg => {
                const selected = boundSet.has(tg.id);
                return (
                  <button
                    key={tg.id}
                    type="button"
                    onClick={() => toggleGroup(tg.id)}
                    className={cn(
                      'px-2.5 py-1 rounded-md border text-xs transition-colors',
                      selected
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    <span className="mr-1">{tg.icon ?? '📋'}</span>
                    {tg.name}
                    <span className="text-text-muted ml-1">({tg.skill_count})</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2">
            Skills that will load ({previewSkills.length})
          </h3>
          {previewSkills.length === 0 ? (
            <p className="text-xs text-text-muted">
              {draftIds.length === 0
                ? 'Select one or more tag groups above.'
                : 'Selected groups have no skills yet. Add skills to a group from Local Skills.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {previewSkills.map(s => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded border border-border bg-bg-primary text-xs text-text-primary"
                >
                  <span className="font-medium truncate">{s.name}</span>
                  {s.description && (
                    <span className="text-text-muted truncate flex-1">{s.description}</span>
                  )}
                  <span className="text-text-muted shrink-0">{s.source_type}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[11px] text-text-muted leading-relaxed">
          Switching to this project installs these skills into each enabled agent&apos;s skill
          directory. Skills from other projects are not removed.
        </p>
      </div>
    </div>
  );
});

ProjectSkillContent.displayName = 'ProjectSkillContent';
export default ProjectSkillContent;
