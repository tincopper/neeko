import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Pencil, Trash2, Plus } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useTaskStore } from "../../store/taskStore";
import { IDE_PRESETS } from "../../utils/idePresets";
import { cn } from "../../utils/cn";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
  Input, Button, Separator,
} from "../ui";
import TaskDialog from "../layout/TaskDialog";
import type { TaskConfig } from "../../types/task";
import type { Project } from "../../types";

interface ProjectPanelProps {
  projectId: string;
  customIdes: { name: string; command: string }[];
  onProjectRemoved: () => void;
}

const ProjectPanel: React.FC<ProjectPanelProps> = ({
  projectId,
  customIdes,
  onProjectRemoved,
}) => {
  const project = useAppStore(
    useCallback((s) => s.projects.find((p: Project) => p.id === projectId), [projectId]),
  );

  const [name, setName] = useState(project?.name ?? "");
  const [activeTaskTab, setActiveTaskTab] = useState<"project" | "app">("project");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<TaskConfig | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);

  const {
    configs,
    loadConfigs,
    addConfig,
    updateConfig,
    deleteConfig,
  } = useTaskStore();

  const projectPath = project?.path ?? null;

  useEffect(() => {
    invoke<{ id: string; name: string; enabled: boolean }[]>("list_agents")
      .then((list) => setAgents(list.filter((a) => a.enabled)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setName(project?.name ?? "");
  }, [project?.name]);

  useEffect(() => {
    if (projectPath) loadConfigs(projectPath);
  }, [projectPath, loadConfigs]);

  const projectTasks = useMemo(
    () => configs.filter((c) => c.scope === "project"),
    [configs],
  );
  const appTasks = useMemo(
    () => configs.filter((c) => c.scope === "app"),
    [configs],
  );

  const patchProject = useCallback(
    (patch: Partial<Project>) => {
      useAppStore.setState((state) => {
        const nextProjects = state.projects.map((p) =>
          p.id === projectId ? { ...p, ...patch } : p,
        );
        return {
          projects: nextProjects,
          activeProject:
            state.activeProjectId === projectId
              ? nextProjects.find((p) => p.id === projectId) ?? state.activeProject
              : state.activeProject,
        };
      });
    },
    [projectId],
  );

  const handleNameBlur = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== project?.name) {
      invoke("rename_project", { projectId, newName: trimmed });
      patchProject({ name: trimmed });
    }
  }, [name, project?.name, projectId, patchProject]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        (e.target as HTMLInputElement).blur();
      }
    },
    [],
  );

  const handleChangePath = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      await invoke("change_project_path", {
        projectId,
        newPath: selected,
      });
    }
  }, [projectId]);

  const handleAgentChange = useCallback(
    (value: string) => {
      const agentId = value === "__global__" ? null : value;
      invoke("set_project_agent", { projectId, agentId });
      patchProject({ selected_agent: agentId });
    },
    [projectId, patchProject],
  );

  const handleIdeChange = useCallback(
    (value: string) => {
      const ide = value === "__global__" ? null : value;
      invoke("set_project_ide", { projectId, ide });
      patchProject({ selected_ide: ide });
    },
    [projectId, patchProject],
  );

  const handleAddTask = useCallback(() => {
    setEditingConfig(null);
    setDialogOpen(true);
  }, []);

  const handleEditTask = useCallback((config: TaskConfig) => {
    setEditingConfig(config);
    setDialogOpen(true);
  }, []);

  const handleDeleteTask = useCallback(
    (config: TaskConfig) => {
      deleteConfig(config.id, config.scope, projectPath ?? undefined);
    },
    [deleteConfig, projectPath],
  );

  const handleDialogSubmit = useCallback(
    (taskName: string, command: string) => {
      if (editingConfig) {
        const updated: TaskConfig = {
          ...editingConfig,
          name: taskName || command,
          command,
        };
        updateConfig(updated, projectPath ?? undefined);
      } else {
        const config: TaskConfig = {
          id: crypto.randomUUID(),
          name: taskName || command,
          command,
          scope: activeTaskTab === "app" ? "app" : "project",
          project_id: projectId,
        };
        addConfig(config, projectPath ?? undefined);
      }
      setDialogOpen(false);
      setEditingConfig(null);
    },
    [editingConfig, projectId, projectPath, activeTaskTab, addConfig, updateConfig],
  );

  const handleRemove = useCallback(() => {
    invoke("remove_project", { projectId });
    onProjectRemoved();
  }, [projectId, onProjectRemoved]);

  const isLocal = !projectPath?.startsWith("\\\\wsl") && !projectPath?.includes("@");

  if (!project) return null;

  const currentTasks = activeTaskTab === "project" ? projectTasks : appTasks;

  return (
    <div className="flex flex-col">
      <h3 className="text-base font-semibold text-text-primary mb-6">
        {project.name}
      </h3>

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
        <div className="text-[0.86em] text-text-primary font-medium mb-1.5">
          Project location
        </div>
        <div className="flex items-center gap-2.5">
          <Input
            value={projectPath ?? ""}
            readOnly
            className="flex-1 text-text-secondary cursor-default"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleChangePath}
            disabled={!isLocal}
            title={isLocal ? "Change project directory" : "Only available for local projects"}
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

      {/* Overrides */}
      <div className="mb-6">
        <div className="text-[0.86em] text-text-primary font-medium mb-1">
          Project Overrides
        </div>
        <div className="text-[0.79em] text-text-muted mb-3">
          Agent and IDE preferences specific to this project.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[0.79em] text-text-muted mb-1.5">Agent</div>
            <Select
              value={project.selected_agent ?? "__global__"}
              onValueChange={handleAgentChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__global__">Use global default</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-[0.79em] text-text-muted mb-1.5">IDE</div>
            <Select
              value={project.selected_ide ?? "__global__"}
              onValueChange={handleIdeChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__global__">Use global default</SelectItem>
                {IDE_PRESETS.map((ide) => (
                  <SelectItem key={ide.id} value={ide.id}>{ide.name}</SelectItem>
                ))}
                {customIdes.map((ide) => (
                  <SelectItem key={ide.name} value={ide.command}>{ide.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Separator className="my-4" />

      {/* Tasks */}
      <div className="mb-6">
        <div className="text-[0.86em] text-text-primary font-medium mb-1">Tasks</div>
        <div className="text-[0.79em] text-text-muted mb-3">
          Shell commands run via the title bar Run button.
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border mb-3">
          <button
            className={cn(
              "px-4 py-2 text-[0.82em] font-medium border-b-2 transition-colors cursor-pointer",
              activeTaskTab === "project"
                ? "text-accent-blue border-accent-blue"
                : "text-text-muted border-transparent hover:text-text-primary",
            )}
            onClick={() => setActiveTaskTab("project")}
          >
            Project
          </button>
          <button
            className={cn(
              "px-4 py-2 text-[0.82em] font-medium border-b-2 transition-colors cursor-pointer",
              activeTaskTab === "app"
                ? "text-accent-blue border-accent-blue"
                : "text-text-muted border-transparent hover:text-text-primary",
            )}
            onClick={() => setActiveTaskTab("app")}
          >
            App (global)
          </button>
        </div>

        {/* Task list */}
        <div className="flex flex-col gap-1.5">
          {currentTasks.length === 0 ? (
            <div className="py-6 text-center text-[0.82em] text-text-muted border border-dashed border-border rounded-md">
              {activeTaskTab === "project"
                ? "No project tasks configured."
                : "No app-level tasks configured."}
            </div>
          ) : (
            currentTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2.5 px-3 py-2.5 bg-bg-tertiary border border-border rounded-md"
              >
                <span className="text-[0.86em] text-text-primary font-medium min-w-[60px]">
                  {task.name}
                </span>
                <span className="flex-1 text-[0.79em] text-text-muted font-mono truncate">
                  {task.command}
                </span>
                <button
                  className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={() => handleEditTask(task)}
                  title="Edit"
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="p-1 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={() => handleDeleteTask(task)}
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        {activeTaskTab === "app" && (
          <div className="mt-2 text-[0.75em] text-text-muted">
            App-level tasks are visible in all projects. Stored in ~/.neeko/tasks.json
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={handleAddTask}
        >
          <Plus size={13} />
          Add Task
        </Button>
      </div>

      {/* Danger zone */}
      <div className="mt-6 pt-6 border-t border-border">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[0.86em] text-text-primary font-medium">
              Remove project
            </div>
            <div className="text-[0.79em] text-text-muted">
              Remove from Neeko. Local files stay intact.
            </div>
          </div>
          {confirmRemove ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmRemove(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemove}
              >
                Confirm
              </Button>
            </div>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {/* Task Dialog */}
      {dialogOpen && (
        <TaskDialog
          onClose={() => { setDialogOpen(false); setEditingConfig(null); }}
          onSubmit={handleDialogSubmit}
          editConfig={editingConfig ?? undefined}
        />
      )}
    </div>
  );
};

export default React.memo(ProjectPanel);
