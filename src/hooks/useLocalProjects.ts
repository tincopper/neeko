import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { destroyTerminalCachesByPrefix } from "../components/terminal";
import type { Project, AgentConfig } from "../types";

export function useLocalProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentConfig[]>([]);

  // 同步 activeProject
  useEffect(() => {
    if (activeProjectId) {
      const project = projects.find((p) => p.id === activeProjectId);
      setActiveProject(project || null);
    } else {
      setActiveProject(null);
    }
  }, [activeProjectId, projects]);

  const loadProjects = useCallback(async () => {
    try {
      const projectList = await invoke<Project[]>("list_projects");
      setProjects(projectList);
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
      setProjects(prev => {
        const next = prev.filter((p) => p.id !== projectId);
        if (activeProjectId === projectId) {
          setActiveProjectId(next.length > 0 ? next[0].id : null);
        }
        return next;
      });
      destroyTerminalCachesByPrefix(projectId);
    } catch (error) {
      console.error("[App] Failed to remove project:", error);
    }
  }, [activeProjectId]);

  const handleSelectProject = useCallback(async (projectId: string) => {
    setActiveProjectId(projectId);
    await invoke("set_active_project", { projectId });
    await invoke("set_view_terminal", { projectId });
    await loadProjects();
  }, [loadProjects]);

  const handleSelectFile = useCallback(async (projectId: string, filePath: string) => {
    if (activeProjectId !== projectId) {
      setActiveProjectId(projectId);
      await invoke("set_active_project", { projectId });
    }
    await invoke("set_view_diff", { projectId, filePath });
    await loadProjects();
  }, [activeProjectId, loadProjects]);

  const handleRefreshGit = useCallback(async (projectId: string) => {
    try {
      await invoke("refresh_git_info", { projectId });
      await loadProjects();
    } catch (error) {
      console.error("Failed to refresh git info:", error);
    }
  }, [loadProjects]);

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
