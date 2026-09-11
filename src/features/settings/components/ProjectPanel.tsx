import { open } from '@tauri-apps/plugin-dialog';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useLspStore } from '@/features/lsp/store/lspStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { Project } from '@/shared/types';
import { reportFrontendError } from '@/shared/utils/errorReporting';
import { Input, Button, Separator } from '@/ui';

import { setProjectAgents, listAgents } from '../../agent/api/agentApi';
import {
  renameProject,
  changeProjectPath,
  setProjectIde,
  setProjectColor,
  removeProject,
  setProjectPrimaryLanguage,
} from '../../project/api/projectApi';

import ProjectAppearanceSection from './ProjectAppearanceSection';
import ProjectDangerZone from './ProjectDangerZone';
import ProjectOverridesSection from './ProjectOverridesSection';
import ProjectTasksSection from './ProjectTasksSection';

interface ProjectPanelProps {
  projectId: string;
  customIdes: { name: string; command: string }[];
  onProjectRemoved: () => void;
}

const ProjectPanel: React.FC<ProjectPanelProps> = ({ projectId, customIdes, onProjectRemoved }) => {
  const project = useProjectStore(
    useCallback((s) => s.projects.find((p: Project) => p.id === projectId), [projectId]),
  );

  const [name, setName] = useState(project?.name ?? '');

  // Sync name when project.name changes
  useEffect(() => {
    // Defer to avoid sync setState in effect
    Promise.resolve().then(() => setName(project?.name ?? ''));
  }, [project?.name]);

  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);

  const projectPath = project?.path ?? null;

  useEffect(() => {
    listAgents()
      .then((list) => setAgents(list.filter((a) => a.enabled)))
      .catch((err) => reportFrontendError('settings.listAgents', err));
  }, []);

  const patchProject = useCallback(
    (patch: Partial<Project>) => {
      useProjectStore.setState((state) => {
        const nextProjects = state.projects.map((p) =>
          p.id === projectId ? { ...p, ...patch } : p,
        );
        return {
          projects: nextProjects,
          activeProject:
            state.activeProjectId === projectId
              ? (nextProjects.find((p) => p.id === projectId) ?? state.activeProject)
              : state.activeProject,
        };
      });
    },
    [projectId],
  );

  const handleNameBlur = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== project?.name) {
      renameProject(projectId, trimmed);
      patchProject({ name: trimmed });
    }
  }, [name, project?.name, projectId, patchProject]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  }, []);

  const handleChangePath = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === 'string') {
      await changeProjectPath(projectId, selected);
    }
  }, [projectId]);

  const handleAgentChange = useCallback(
    (value: string) => {
      const agentId = value === '__global__' ? null : value;
      setProjectAgents(projectId, agentId ? [agentId] : []);
      patchProject({ selected_agents: agentId ? [agentId] : [] });
    },
    [projectId, patchProject],
  );

  const handleIdeChange = useCallback(
    (value: string) => {
      const ide = value === '__global__' ? null : value;
      setProjectIde(projectId, ide);
      patchProject({ selected_ide: ide });
    },
    [projectId, patchProject],
  );

  const handleAvatarColorChange = useCallback(
    (color: string | null) => {
      setProjectColor(projectId, color).catch((e) => {
        console.error('[ProjectPanel] Failed to set avatar color:', e);
      });
      patchProject({ avatar_color: color });
    },
    [projectId, patchProject],
  );

  const handlePrimaryLanguageChange = useCallback(
    (value: string) => {
      const language = value === '__auto__' ? null : value;
      setProjectPrimaryLanguage(projectId, language).catch((e) => {
        console.error('[ProjectPanel] Failed to set primary language:', e);
      });
      patchProject({ primary_language: language });
    },
    [projectId, patchProject],
  );

  const projectProfile = useLspStore((s) =>
    projectPath ? (s.profiles[projectPath] ?? null) : null,
  );

  /** Detected + common languages for the primary selector. */
  const primaryLanguageOptions = useMemo(() => {
    const fromProfile = (projectProfile?.candidates ?? []).map((c) => ({
      id: c.languageId,
      label: `${c.languageId} (${c.serverName})`,
    }));
    const seen = new Set(fromProfile.map((o) => o.id));
    const builtins = [
      { id: 'go', label: 'go (gopls)' },
      { id: 'rust', label: 'rust (rust-analyzer)' },
      { id: 'typescript', label: 'typescript (typescript-language-server)' },
      { id: 'javascript', label: 'javascript (typescript-language-server)' },
      { id: 'python', label: 'python (pyright)' },
      { id: 'java', label: 'java (jdtls)' },
      { id: 'cpp', label: 'cpp (clangd)' },
    ];
    for (const b of builtins) {
      if (!seen.has(b.id)) {
        fromProfile.push(b);
        seen.add(b.id);
      }
    }
    // Keep current override visible even if not in lists
    const current = project?.primary_language;
    if (current && !seen.has(current)) {
      fromProfile.unshift({ id: current, label: current });
    }
    return fromProfile;
  }, [projectProfile, project?.primary_language]);

  const handleRemove = useCallback(() => {
    removeProject(projectId);
    onProjectRemoved();
  }, [projectId, onProjectRemoved]);

  const isLocal = !projectPath?.startsWith('\\\\wsl') && !projectPath?.includes('@');

  if (!project) return null;

  return (
    <div className="flex flex-col">
      <h3 className="text-base font-semibold text-text-primary mb-6">{project.name}</h3>

      {/* Name */}
      <div className="mb-6">
        <div className="text-[0.86em] text-text-primary font-medium mb-1.5">Name</div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={handleNameKeyDown}
        />
      </div>

      {/* Path */}
      <div className="mb-6">
        <div className="text-[0.86em] text-text-primary font-medium mb-1.5">Project location</div>
        <div className="flex items-center gap-2.5">
          <Input
            value={projectPath ?? ''}
            readOnly
            className="flex-1 text-text-secondary cursor-default"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleChangePath}
            disabled={!isLocal}
            title={isLocal ? 'Change project directory' : 'Only available for local projects'}
          >
            Change...
          </Button>
        </div>
        {!isLocal && (
          <div className="text-[0.79em] text-text-muted mt-1.5">
            Path change is only available for local projects.
          </div>
        )}
      </div>

      <Separator className="my-4" />

      <ProjectOverridesSection
        project={project}
        agents={agents}
        customIdes={customIdes}
        projectProfile={projectProfile}
        primaryLanguageOptions={primaryLanguageOptions}
        onAgentChange={handleAgentChange}
        onIdeChange={handleIdeChange}
        onPrimaryLanguageChange={handlePrimaryLanguageChange}
      />

      <Separator className="my-4" />

      <ProjectTasksSection projectId={projectId} projectPath={projectPath} />

      <Separator className="my-4" />

      <Separator className="my-4" />

      <ProjectAppearanceSection
        avatarColor={project.avatar_color}
        onChange={handleAvatarColorChange}
      />

      <ProjectDangerZone onRemove={handleRemove} />
    </div>
  );
};

export default React.memo(ProjectPanel);
