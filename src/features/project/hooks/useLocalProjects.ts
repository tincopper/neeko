import { open } from '@tauri-apps/plugin-dialog';
import type { Dispatch, SetStateAction } from 'react';
import { useState, useCallback } from 'react';
import { useShallow } from 'zustand/shallow';

// eslint-disable-next-line import/no-restricted-paths -- useLocalProjects cleans terminal caches on project close
import { destroyTerminalCachesByPrefix } from '@/features/terminal';
import { bumpGitRefresh } from '@/shared/hooks/useGitRefresh';
import { useEditorStore } from '@/shared/store/editorStore';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Project, AgentConfig, Tab, FileChange, Worktree } from '@/shared/types';
import { aheadBehindKey } from '@/shared/utils/aheadBehindKey';
import { applyStateAction } from '@/shared/utils/entryUpdates';
import { getMacAppNameByCommand, resolveIdeLaunchCommand } from '@/shared/utils/idePresets';
import { randomAvatarColor } from '@/shared/utils/projectAvatar';

// eslint-disable-next-line import/no-restricted-paths -- useLocalProjects needs agent API for listing agents
import { listAgents } from '../../agent/api/agentApi';
// eslint-disable-next-line import/no-restricted-paths -- useLocalProjects needs git API for branch/worktree info
import { getWorktreeChangedFiles, getGitBranchInfo, getAheadBehind } from '../../git/api/gitApi';
// eslint-disable-next-line import/no-restricted-paths -- useLocalProjects needs session API for persistence
import { saveSession } from '../../session/api/sessionApi';
import {
  addProject,
  removeProject,
  setActiveProject as setActiveProjectApi,
  openIde,
  reorderProjects,
  listProjects,
} from '../api/projectApi';

export function useLocalProjects() {
  const projects = useProjectStore(useShallow((state) => state.projects));
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);

  const setProjects: Dispatch<SetStateAction<Project[]>> = useCallback((updater) => {
    useProjectStore.setState((state) => {
      const nextProjects = applyStateAction(state.projects, updater);
      const nextActiveProject = state.activeProjectId
        ? (nextProjects.find((project) => project.id === state.activeProjectId) ?? null)
        : null;
      return {
        projects: nextProjects,
        activeProject: nextActiveProject,
      };
    });
  }, []);

  const setActiveProjectId = useCallback((projectId: string | null) => {
    const tabs = useEditorStore.getState().tabs;
    const targetProjectTabs = projectId ? tabs[projectId] : null;
    const restoredTabId = targetProjectTabs?.activeTabId ?? null;

    useProjectStore.setState((state) => ({
      activeProjectId: projectId,
      activeProject: projectId
        ? (state.projects.find((project) => project.id === projectId) ?? null)
        : null,
    }));

    useEditorStore.setState({ activeTabId: restoredTabId });
  }, []);

  const setActiveProject: Dispatch<SetStateAction<Project | null>> = useCallback((updater) => {
    useProjectStore.setState((state) => ({
      activeProject: applyStateAction(state.activeProject, updater),
    }));
  }, []);

  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<AgentConfig[]>([]);

  const loadProjects = useCallback(async () => {
    try {
      const projectList = await listProjects();

      // 合并逻辑：保�?store 中已有的 git_info.changed_files
      // list_projects 返回的项�?changed_files 为空（轻量版�?
      // changed_files �?watcher/handleRefreshGit 维护
      setProjects((prev) => {
        const prevMap = new Map(prev.map((p) => [p.id, p]));
        return projectList.map((newProject) => {
          const existing = prevMap.get(newProject.id);
          if (existing?.git_info?.changed_files && existing.git_info.changed_files.length > 0) {
            // 保留已有�?changed_files
            return {
              ...newProject,
              git_info: newProject.git_info
                ? {
                    ...newProject.git_info,
                    changed_files: existing.git_info.changed_files,
                  }
                : existing.git_info,
            };
          }
          return newProject;
        });
      });
    } catch (error) {
      console.error('[App] Failed to load projects:', error);
    }
  }, [setProjects]);

  const loadAgents = useCallback(async () => {
    try {
      const agentList = await listAgents();
      setAgents(agentList);
    } catch (error) {
      console.error('[App] Failed to load agents:', error);
    }
  }, []);

  /** Shared tail of "add a local project": duplicate check → backend → store → activate. */
  const addProjectFromPath = useCallback(
    async (path: string) => {
      const exists = projects.some((p) => p.path === path);
      if (exists) {
        throw new Error(`Project already added: ${path}`);
      }
      const project = await addProject(path, null, null, randomAvatarColor());
      await saveSession().catch((e) => console.error('[App] Failed to save session:', e));
      setProjects((prev) => [...prev, project]);
      setActiveProjectId(project.id);
      setActiveProject(project);
      setActiveProjectApi(project.id).catch(console.error);
      return project;
    },
    [projects, setActiveProject, setActiveProjectId, setProjects],
  );

  const handleAddProject = useCallback(async () => {
    try {
      setLoading(true);
      const selected = await open({ multiple: false, directory: true });
      if (selected) {
        try {
          await addProjectFromPath(selected);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // addProjectFromPath 已做判重：复用其错误信息做 alert，保持 UX 一致
          if (message.includes('already added')) {
            alert(message);
          } else {
            throw e;
          }
        }
      }
    } catch (error) {
      console.error('[App] Failed to add project:', error);
    } finally {
      setLoading(false);
    }
  }, [addProjectFromPath]);

  const handleRemoveProject = useCallback(async (projectId: string) => {
    try {
      await removeProject(projectId);

      const projState = useProjectStore.getState();
      const editorState = useEditorStore.getState();

      const nextProjects = projState.projects.filter((project) => project.id !== projectId);
      const nextActiveProjectId =
        projState.activeProjectId === projectId
          ? (nextProjects[0]?.id ?? null)
          : projState.activeProjectId;
      const nextActiveProject = nextActiveProjectId
        ? (nextProjects.find((project) => project.id === nextActiveProjectId) ?? null)
        : null;
      const nextActiveTabId = nextActiveProjectId
        ? (editorState.tabs[nextActiveProjectId]?.activeTabId ?? null)
        : null;

      useProjectStore.setState({
        projects: nextProjects,
        activeProjectId: nextActiveProjectId,
        activeProject: nextActiveProject,
      });
      useEditorStore.setState({ activeTabId: nextActiveTabId });

      destroyTerminalCachesByPrefix(projectId);
    } catch (error) {
      console.error('[App] Failed to remove project:', error);
    }
  }, []);

  const handleSelectProject = useCallback(
    async (projectId: string) => {
      setActiveProjectId(projectId);
      // fire-and-forget: 通知后端，不阻塞前端切换
      setActiveProjectApi(projectId).catch(console.error);
    },
    [setActiveProjectId],
  );

  const handleSelectFile = useCallback(
    async (projectId: string, filePath: string) => {
      if (activeProjectId !== projectId) {
        setActiveProjectId(projectId);
        await setActiveProjectApi(projectId);
      }

      const existingTabs = useEditorStore.getState().tabs[projectId];
      const existingDiffTab = existingTabs?.tabs.find(
        (t) => t.data.kind === 'diff' && t.data.filePath === filePath,
      );
      if (existingDiffTab) {
        useEditorStore.getState().activateTab(projectId, existingDiffTab.id);
        return;
      }

      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
        id: tabId,
        projectId,
        title: fileName,
        order: existingTabs?.tabs.length ?? 0,
        data: {
          kind: 'diff',
          filePath,
          fileName,
          diffSource: { type: 'local', projectId },
        },
      };
      useEditorStore.getState().addTab(projectId, tab);
      useEditorStore.getState().activateTab(projectId, tabId);
    },
    [activeProjectId, setActiveProjectId],
  );

  const handleRefreshGit = useCallback(
    async (projectId: string) => {
      // 通知 diff 等依赖 Git 状态的缓存失效
      bumpGitRefresh(projectId);
      const defaultGitInfo = {
        current_branch: '',
        branches: [] as string[],
        worktrees: [] as Worktree[],
        changed_files: [] as FileChange[],
        is_clean: true,
        git_provider: '',
      };

      const updateProjectGitInfo = (patch: Partial<typeof defaultGitInfo>) => {
        useProjectStore.setState((state) => {
          const nextProjects = state.projects.map((p) => {
            if (p.id !== projectId) return p;
            return { ...p, git_info: { ...(p.git_info ?? defaultGitInfo), ...patch } };
          });
          return {
            projects: nextProjects,
            activeProject:
              state.activeProjectId === projectId
                ? (nextProjects.find((p) => p.id === projectId) ?? state.activeProject)
                : state.activeProject,
          };
        });
      };

      try {
        // 非 git 项目跳过所有 git 命令
        const proj = useProjectStore.getState().projects.find((p) => p.id === projectId);
        if (proj?.git_info === null) return;

        const changedFiles = await getWorktreeChangedFiles(projectId, activeWorktreePath ?? '');
        updateProjectGitInfo({ changed_files: changedFiles, is_clean: changedFiles.length === 0 });

        getGitBranchInfo(projectId, activeWorktreePath)
          .then((branchInfo) => {
            updateProjectGitInfo({
              current_branch: branchInfo.current_branch,
              branches: branchInfo.branches,
              worktrees: branchInfo.worktrees,
            });
          })
          .catch((error) => console.error('Failed to refresh git branch info:', error));

        // 同步 ahead/behind（待 push 数量），与 changed_files 一并刷新
        getAheadBehind(projectId, activeWorktreePath)
          .then((ab) => {
            useGitStore
              .getState()
              .setAheadBehind(aheadBehindKey('local', projectId, projectId), ab);
          })
          .catch((error) => console.error('Failed to refresh ahead/behind:', error));
      } catch (error) {
        console.error('Failed to refresh git info:', error);
      }
    },
    [activeWorktreePath],
  );

  const handleOpenIde = useCallback(
    async (project: { id: string; selected_ide: string | null }) => {
      if (!project.selected_ide) return;
      const projectPath = projects.find((item) => item.id === project.id)?.path ?? '';
      // selected_ide may be preset id (`vscode`) or launch command (`code`)
      const launchCmd = resolveIdeLaunchCommand(project.selected_ide) ?? project.selected_ide;
      const macAppName = getMacAppNameByCommand(project.selected_ide);
      await openIde(launchCmd, projectPath, macAppName);
    },
    [projects],
  );

  const handleDragEnd = useCallback(
    (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;
      setProjects((prev) => {
        const draggedIndex = prev.findIndex((p) => p.id === draggedId);
        const targetIndex = prev.findIndex((p) => p.id === targetId);
        if (draggedIndex < 0 || targetIndex < 0) return prev;

        const newProjects = [...prev];
        const [dragged] = newProjects.splice(draggedIndex, 1);
        newProjects.splice(targetIndex, 0, dragged);

        // Persist the new order
        const orderedIds = newProjects.map((p) => p.id);
        reorderProjects(orderedIds).catch((e) =>
          console.error('[App] Failed to persist project order:', e),
        );

        return newProjects;
      });
    },
    [setProjects],
  );

  return {
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    activeProject,
    setActiveProject,
    loading,
    setLoading,
    agents,
    loadProjects,
    loadAgents,
    handleAddProject,
    addProjectFromPath,
    handleRemoveProject,
    handleSelectProject,
    handleSelectFile,
    handleRefreshGit,
    handleOpenIde,
    handleDragEnd,
  };
}
