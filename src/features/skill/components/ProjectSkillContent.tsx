import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, Loader2, RefreshCw, Check } from 'lucide-react';
import { Button } from '@/ui';
import { useSkillStore } from '@/features/skill/store';
import { useProjectStore } from '@/features/project/store';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/features/notification/notificationStore';
import { getSkillsForTagGroup } from '@/features/skill/api/skillApi';
import type { ManagedSkillDto } from '@/shared/types';

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
    void loadProjectTagGroups(activeProjectId).catch(e => toast(String(e), 'error'));
  }, [activeProjectId, loadProjectTagGroups, toast]);

  useEffect(() => {
    if (!dirty) {
      setDraftIds(projectTagGroups.map(g => g.id));
    }
  }, [projectTagGroups, dirty]);

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
      toast('Bindings saved');
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
      toast('Skills applied to agents');
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  }, [activeProjectId, dirty, draftIds, setProjectTagGroups, applyProjectSkills, toast]);

  if (!activeProjectId || !activeProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3 px-8">
        <div className="w-10 h-10 rounded-lg bg-bg-hover flex items-center justify-center">
          <FolderOpen className="h-5 w-5 opacity-50" />
        </div>
        <p className="text-[var(--font-size)] text-text-secondary font-medium">No project selected</p>
        <p className="text-[11px] text-center max-w-[260px] leading-relaxed">
          Select a project to bind tag groups. Bound skills install into agent directories on switch
          (never removed from others).
        </p>
      </div>
    );
  }

  const isApplying = applyingProjectId === activeProjectId || saving;

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 h-9 px-3 border-b border-border shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-[var(--font-size)] font-semibold text-text-primary truncate">
            Project Skills
          </div>
        </div>
        <span className="text-[11px] text-text-muted truncate max-w-[40%]">{activeProject.name}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={!dirty || isApplying}
          onClick={() => void handleSave()}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] gap-1 text-text-secondary hover:text-text-primary"
          disabled={isApplying || draftIds.length === 0}
          onClick={() => void handleApply()}
        >
          {isApplying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Apply
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-2">
        <div className="px-3 py-1.5 text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted">
          Bound groups
        </div>

        {projectBindingsLoading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-text-muted text-[11px]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : tagGroups.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-text-muted leading-relaxed">
            Create a tag group in the Skills sidebar first.
          </p>
        ) : (
          <div className="pb-2">
            {tagGroups.map(tg => {
              const selected = boundSet.has(tg.id);
              return (
                <button
                  key={tg.id}
                  type="button"
                  onClick={() => toggleGroup(tg.id)}
                  className={cn(
                    'flex items-center gap-2.5 w-[calc(100%-12px)] mx-1.5 pl-3 pr-2 py-2 rounded-md text-left transition-colors duration-150',
                    selected
                      ? 'bg-bg-selected text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                  )}
                >
                  <span
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                      selected
                        ? 'bg-accent-green/20 border-accent-green text-accent-green'
                        : 'border-border bg-transparent',
                    )}
                  >
                    {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                  <span className="text-[var(--font-size)] font-medium truncate flex-1">
                    {tg.name}
                  </span>
                  <span className="text-[10.5px] text-text-muted tabular-nums">
                    {tg.skill_count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="px-3 pt-2 pb-1.5 text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted border-t border-border mt-1">
          Will load
          <span className="ml-1.5 font-medium tracking-normal normal-case text-text-muted/80">
            {previewSkills.length}
          </span>
        </div>

        {previewSkills.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-text-muted leading-relaxed">
            {draftIds.length === 0
              ? 'Select one or more tag groups above.'
              : 'Selected groups have no skills yet.'}
          </p>
        ) : (
          <ul className="pb-3">
            {previewSkills.map(s => (
              <li
                key={s.id}
                className="flex items-center gap-2 pl-3 pr-3 py-1.5 mx-1.5 text-[var(--font-size)]"
              >
                <span className="font-medium text-text-primary truncate">{s.name}</span>
                {s.description && (
                  <span className="text-[0.85em] text-text-muted truncate flex-1">
                    {s.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="px-3 pb-4 text-[11px] text-text-muted leading-relaxed">
          Switching to this project installs bound skills into agent directories. Other skills are
          left in place.
        </p>
      </div>
    </div>
  );
});

ProjectSkillContent.displayName = 'ProjectSkillContent';
export default ProjectSkillContent;
