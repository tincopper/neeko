import { useState, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useShallow } from "zustand/shallow";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { destroyTerminalCachesByPrefix } from "../components/terminal";
import type { Project, AgentConfig, Tab, GitBranchInfo, FileChange, Worktree } from "../types";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { applyStateAction } from "../utils/entryUpdates";
import { randomAvatarColor } from "../utils/projectAvatar";
import { getMacAppNameByCommand } from "../utils/idePresets";

export function useLocalProjects() {
  const projects = useProjectStore(useShallow((state) => state.projects));
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useProjectStore((state) => state.activeProject);

  const setProjects: Dispatch<SetStateAction<Project[]>> = useCallback((updater) => {
    useProjectStore.setState((state) => {
      const nextProjects = applyStateAction(state.projects, updater);
      const nextActiveProject = state.activeProjectId
        ? nextProjects.find((project) => project.id === state.activeProjectId) ?? null
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
        ? state.projects.find((project) => project.id === projectId) ?? null
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
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentConfig[]>([]);

  const loadProjects = useCallback(async () => {
    try {
      const projectList = await invoke<Project[]>("list_projects");
      
      // 合并逻辑：保留 store 中已有的 git_info.changed_files
      // list_projects 返回的项目 changed_files 为空（轻量版）
      // changed_files 由 watcher/handleRefreshGit 维护
      setProjects((prev) => {
        const prevMap = new Map(prev.map(p => [p.id, p]));
        return projectList.map((newProject) => {
          const existing = prevMap.get(newProject.id);
          if (existing?.git_info?.changed_files && existing.git_info.changed_files.length > 0) {
            // 保留已有的 changed_files
            return {
              ...newProject,
              git_info: newProject.git_info ? {
                ...newProject.git_info,
                changed_files: existing.git_info.changed_files,
              } : existing.git_info,
            };
          }
          return newProject;
        });
      });
    } catch (error) {
      console.error("[App] Failed to load projects:", error);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    try {
      const agentList = await invoke<AgentConfig[]>("list_agents");
      setAgents(agentList);
    } catch (error) {
      console.error("[App] Failed to load agents:", error);
    }
  }, []);

  const handleAddProject = useCallback(async () => {
    try {
      setLoading(true);
      await loadAgents();
      const selected = await open({ multiple: false, directory: true });
      if (selected) {
        const exists = projects.some((p) => p.path === selected);
        if (exists) {
          alert(`Project already added: ${selected}`);
          return;
        }
        setPendingPath(selected);
      }
    } catch (error) {
      console.error("[App] Failed to open dialog:", error);
    } finally {
      setLoading(false);
    }
  }, [projects, loadAgents]);

  const handleConfirmAddProject = useCallback(async (agentId: string | null, ideCommand: string | null) => {
    if (!pendingPath) return;
    try {
      setLoading(true);
      const project = await invoke<Project>("add_project", {
        path: pendingPath,
        agentId,
        ide: ideCommand,
        // 新建项目随机分配一个调色板内的 avatar 颜色（立即持久化）
        avatarColor: randomAvatarColor(),
      });
      await invoke("save_session").catch(() => {});
      setProjects((prev) => [...prev, project]);
      setActiveProjectId(project.id);
      setActiveProject(project);
    } catch (error) {
      console.error("[App] Failed to add project:", error);
    } finally {
      setLoading(false);
      setPendingPath(null);
    }
  }, [pendingPath]);

  const handleRemoveProject = useCallback(async (projectId: string) => {
    try {
      await invoke("remove_project", { projectId });

      const projState = useProjectStore.getState();
      const editorState = useEditorStore.getState();

      const nextProjects = projState.projects.filter((project) => project.id !== projectId);
      const nextActiveProjectId = projState.activeProjectId === projectId
        ? (nextProjects[0]?.id ?? null)
        : projState.activeProjectId;
      const nextActiveProject = nextActiveProjectId
        ? nextProjects.find((project) => project.id === nextActiveProjectId) ?? null
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
      console.error("[App] Failed to remove project:", error);
    }
  }, []);

  const handleSelectProject = useCallback(async (projectId: string) => {
    setActiveProjectId(projectId);
    // fire-and-forget: 通知后端，不阻塞前端切换
    invoke("set_active_project", { projectId }).catch(console.error);
  }, []);

  const handleSelectFile = useCallback(async (projectId: string, filePath: string) => {
    if (activeProjectId !== projectId) {
      setActiveProjectId(projectId);
      await invoke("set_active_project", { projectId });
    }

    const existingTabs = useEditorStore.getState().tabs[projectId];
    const existingDiffTab = existingTabs?.tabs.find(
      (t) => t.data.kind === "diff" && t.data.filePath === filePath
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
        kind: "diff",
        filePath,
        fileName,
        diffSource: { type: "local", projectId },
      },
    };
    useEditorStore.getState().addTab(projectId, tab);
    useEditorStore.getState().activateTab(projectId, tabId);
  }, [activeProjectId]);

  const handleRefreshGit = useCallback(async (projectId: string) => {
    const defaultGitInfo = {
      current_branch: "",
      branches: [] as string[],
      worktrees: [] as Worktree[],
      changed_files: [] as FileChange[],
      is_clean: true,
    };

    const updateProjectGitInfo = (patch: Partial<typeof defaultGitInfo>) => {
      useProjectStore.setState((state) => {
        const nextProjects = state.projects.map((p) => {
          if (p.id !== projectId) return p;
          return { ...p, git_info: { ...(p.git_info ?? defaultGitInfo), ...patch } };
        });
        return {
          projects: nextProjects,
          activeProject: state.activeProjectId === projectId
            ? nextProjects.find(p => p.id === projectId) ?? state.activeProject
            : state.activeProject,
        };
      });
    };

    try {
      const projectPath = projects.find(p => p.id === projectId)?.path ?? "";
      const changedFiles = await invoke<FileChange[]>("unified_get_worktree_changed_files", {
        transport: { Local: { project_path: projectPath } },
        worktreePath: "",
      });
      updateProjectGitInfo({ changed_files: changedFiles, is_clean: changedFiles.length === 0 });

      invoke<GitBranchInfo>("unified_get_git_branch_info", {
        transport: { Local: { project_path: projectPath } },
      })
        .then((branchInfo) => {
          updateProjectGitInfo({
            current_branch: branchInfo.current_branch,
            branches: branchInfo.branches,
            worktrees: branchInfo.worktrees,
          });
        })
        .catch((error) => console.error("Failed to refresh git branch info:", error));
    } catch (error) {
      console.error("Failed to refresh git info:", error);
    }
  }, []);

  const handleOpenIde = useCallback(async (project: { id: string; selected_ide: string | null }) => {
    if (!project.selected_ide) return;
    const projectPath = projects.find((item) => item.id === project.id)?.path ?? "";
    const macAppName = getMacAppNameByCommand(project.selected_ide);
    await invoke("open_ide", {
      ideCommand: project.selected_ide,
      projectPath,
      macAppName,
    });
  }, [projects]);

  const handleDragEnd = useCallback((draggedId: string, targetId: string) => {
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
      invoke("reorder_projects", { orderedIds }).catch((e) =>
        console.error("[App] Failed to persist project order:", e)
      );

      return newProjects;
    });
  }, []);

  return {
    projects, setProjects, activeProjectId, setActiveProjectId,
    activeProject, setActiveProject,
    loading, setLoading,
    pendingPath, setPendingPath,
    agents,
    loadProjects, loadAgents,
    handleAddProject, handleConfirmAddProject, handleRemoveProject,
    handleSelectProject, handleSelectFile, handleRefreshGit, handleOpenIde,
    handleDragEnd,
  };
}
