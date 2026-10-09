import { open } from '@tauri-apps/plugin-dialog';
import type { Dispatch, SetStateAction } from 'react';
import { useState, useCallback } from 'react';
import { useShallow } from 'zustand/shallow';

// eslint-disable-next-line import/no-restricted-paths -- useLocalProjects cleans terminal caches on project close
import { destroyTerminalCachesByPrefix } from '@/features/terminal';
import { bumpGitRefresh } from '@/shared/hooks/useGitRefresh';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { selectActiveCheckoutPath, useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Project, AgentConfig, Tab, Worktree } from '@/shared/types';
import { applyStateAction } from '@/shared/utils/entryUpdates';
import { getMacAppNameByCommand, resolveIdeLaunchCommand } from '@/shared/utils/idePresets';
import { randomAvatarColor } from '@/shared/utils/projectAvatar';
import { parseWorkspaceKey, workspaceKeyOf } from '@/shared/utils/workspaceRef';

// eslint-disable-next-line import/no-restricted-paths -- useLocalProjects needs agent API for listing agents
import { listAgents } from '../../agent/api/agentApi';
// eslint-disable-next-line import/no-restricted-paths -- useLocalProjects needs git API for branch/worktree info
import { getGitBranchInfo } from '../../git/api/gitApi';
// eslint-disable-next-line import/no-restricted-paths -- useLocalProjects reuses the gated refresh entry for workspace status
import { refreshWorkspaceStatus } from '../../git/utils/gitStatus';
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
      // 直接采用后端返回值：git_info 只含 per-project 元数据（分支 / 工作树清单 /
      // provider）。旧实现在此「保留已有 changed_files 防止被轻量返回覆盖」——
      // 那是共享单槽的补丁：它会把上一个单元 / 上一次会话的变更列表永久留在槽里。
      setProjects(await listProjects());
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

      // R1：项目确认移除后，清空该项目派生的**全部** tab 键空间（基础键 + worktree
      // 变体，键格式唯一事实源 = workspaceRef.ts 的 workspaceKeyOf）。归属判定用
      // parseWorkspaceKey(k).projectId 精确匹配，避免字符串前缀误伤相邻 id（p1 vs
      // p10）；枚举 editorStore.tabs 现存键即完整键空间 —— 键仅在 tab 打开时存在，
      // 无需穷举 worktree 路径。逐一走 clearProjectTabs（R2：
      // 其内 dropNavigateGoalFor 级联清 navigateGoal + activeTabId 兜底 + 按 kind
      // 触发 tab cleanup），不绕开单写 helper 自行改 tabs 结构。上方 await 抛出
      // 即走 catch，不会触碰 tabs（R3）。
      for (const tabKey of Object.keys(useEditorStore.getState().tabs)) {
        if (parseWorkspaceKey(tabKey).projectId === projectId) {
          useEditorStore.getState().clearProjectTabs(tabKey);
        }
      }

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

  const handleRefreshGit = useCallback(async (projectId: string) => {
    // 通知 diff 等依赖 Git 状态的缓存失效
    bumpGitRefresh(projectId);
    const defaultGitInfo = {
      current_branch: '',
      branches: [] as string[],
      worktrees: [] as Worktree[],
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

      // 刷新目标 = **本项目**当前激活的单元（旧实现读全局镜像的 activeWorktreePath，
      // 于是刷新 B 项目会用 A 项目的 worktree 路径，结果写进 B 的槽）。
      const checkoutPath = selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
      await refreshWorkspaceStatus(workspaceKeyOf(projectId, checkoutPath));

      getGitBranchInfo(projectId, checkoutPath)
        .then((branchInfo) => {
          // 只合并 per-project 元数据（分支清单 / 工作树清单）。
          // `current_branch` **不在这里写**：它是「某个Workspace的 HEAD」，唯一写者是
          // `projectStore.applyStatus` 的主仓单元投影 —— 视图分支由各面板按单元槽位读
          // （`selectBranch` / GitControlPanelWrapper）。在这里写会拿**激活单元**（可能是
          // worktree）的分支覆盖项目卡片，随后主仓快照一到又改回去（抖动），
          // 且与 useSessionBootstrap / PullRequestsPanelWrapper 声明的唯一写者自相矛盾。
          updateProjectGitInfo({
            branches: branchInfo.branches,
            worktrees: branchInfo.worktrees,
          });
        })
        .catch((error) => console.error('Failed to refresh git branch info:', error));
    } catch (error) {
      console.error('Failed to refresh git info:', error);
    }
  }, []);

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
