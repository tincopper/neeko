import { useState, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { destroyTerminalCachesByPrefix } from "../components/terminal";
import type { Project, AgentConfig, Tab, GitBranchInfo, FileChange, Worktree } from "../types";
import { useAppStore } from "../store/appStore";
import { applyStateAction } from "../utils/entryUpdates";

export function useLocalProjects() {
  const projects = useAppStore((state) => state.projects);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeProject = useAppStore((state) => state.activeProject);

  const setProjects: Dispatch<SetStateAction<Project[]>> = useCallback((updater) => {
    useAppStore.setState((state) => {
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
    useAppStore.setState((state) => {
      const targetProjectTabs = projectId ? state.tabs[projectId] : null;
      const restoredTabId = targetProjectTabs?.activeTabId ?? null;

      return {
        activeProjectId: projectId,
        activeProject: projectId
          ? state.projects.find((project) => project.id === projectId) ?? null
          : null,
        activeTabId: restoredTabId,
      };
    });
  }, []);

  const setActiveProject: Dispatch<SetStateAction<Project | null>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
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
      useAppStore.setState((state) => {
        const nextProjects = state.projects.filter((project) => project.id !== projectId);
        const nextActiveProjectId = state.activeProjectId === projectId
          ? (nextProjects[0]?.id ?? null)
          : state.activeProjectId;
        const nextActiveProject = nextActiveProjectId
          ? nextProjects.find((project) => project.id === nextActiveProjectId) ?? null
          : null;
        const nextActiveTabId = nextActiveProjectId
          ? (state.tabs[nextActiveProjectId]?.activeTabId ?? null)
          : null;
        return {
          projects: nextProjects,
          activeProjectId: nextActiveProjectId,
          activeProject: nextActiveProject,
          activeTabId: nextActiveTabId,
        };
      });
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

    const existingTabs = useAppStore.getState().tabs[projectId];
    const existingDiffTab = existingTabs?.tabs.find(
      (t) => t.data.kind === "diff" && t.data.filePath === filePath
    );
    if (existingDiffTab) {
      useAppStore.getState().activateTab(projectId, existingDiffTab.id);
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
    useAppStore.getState().addTab(projectId, tab);
    useAppStore.getState().activateTab(projectId, tabId);
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
      useAppStore.setState((state) => {
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
      const changedFiles = await invoke<FileChange[]>("get_worktree_changed_files", { projectId, worktreePath: "" });
      updateProjectGitInfo({ changed_files: changedFiles, is_clean: changedFiles.length === 0 });

      invoke<GitBranchInfo>("get_git_branch_info_command", { projectId })
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
    try {
      const projectPath = projects.find((item) => item.id === project.id)?.path ?? "";
      await invoke("open_ide", {
        ideCommand: project.selected_ide,
        projectPath,
      });
    } catch (e: unknown) {
      console.error("[App] Failed to open IDE:", e);
    }
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
