import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, ChevronDown, Plus, Pencil, X, Download } from "@/shared/components/icons"
import { useTaskStore } from "../store";
import { useProjectStore } from '@/features/project/store';
import TaskDialog from "./TaskDialog";
import type { DiscoveredTask, TaskConfig } from '@/shared/types/task';

// ── TaskRunButton ────────────────────────────────────────────────────────────

function TaskRunButton() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<TaskConfig | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    configs,
    discovered,
    discovering,
    consoleSessions,
    selectedConfigId,
    loadConfigs,
    loadDiscovered,
    importDiscovered,
    importAllDiscovered,
    addConfig,
    updateConfig,
    deleteConfig,
    runTask,
    stopTask,
    setSelectedConfig,
  } = useTaskStore();

  const activeProject = useProjectStore((s) => s.activeProject);
  const projectPath = activeProject?.path ?? null;
  const currentProjectId = activeProject?.id ?? "";

  // Load saved + discover when project changes
  useEffect(() => {
    void (async () => {
      await loadConfigs(projectPath ?? undefined);
      await loadDiscovered(projectPath);
    })();
  }, [projectPath, loadConfigs, loadDiscovered]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  // Running if the selected task (or any project task) has an active console session
  const isRunning = useMemo(() => {
    const sessions = consoleSessions.filter((s) => s.projectId === currentProjectId);
    if (selectedConfigId) {
      return sessions.some(
        (s) => s.configId === selectedConfigId && s.status === "running",
      );
    }
    return sessions.some((s) => s.status === "running");
  }, [consoleSessions, currentProjectId, selectedConfigId]);

  const selectedLabel = useMemo(() => {
    const saved = configs.find((c) => c.id === selectedConfigId);
    if (saved) return saved.name;
    const disc = discovered.find((d) => d.id === selectedConfigId);
    if (disc) return disc.name;
    return null;
  }, [configs, discovered, selectedConfigId]);

  const canRun = isRunning || !!selectedConfigId;

  const resolveRunnable = useCallback(
    (id: string | null): { command: string; id: string } | null => {
      if (!id) return null;
      const saved = configs.find((c) => c.id === id);
      if (saved) return { command: saved.command, id: saved.id };
      const disc = discovered.find((d) => d.id === id);
      if (disc) return { command: disc.command, id: disc.id };
      return null;
    },
    [configs, discovered],
  );

  const handlePlayStop = useCallback(() => {
    if (isRunning) {
      stopTask();
      return;
    }
    const runnable = resolveRunnable(selectedConfigId);
    if (runnable) runTask(runnable.command, runnable.id);
  }, [isRunning, selectedConfigId, resolveRunnable, runTask, stopTask]);

  const handleSelectAndRunSaved = useCallback(
    (config: TaskConfig) => {
      setSelectedConfig(config.id);
      runTask(config.command, config.id);
      setDropdownOpen(false);
    },
    [runTask, setSelectedConfig],
  );

  const handleSelectAndRunDiscovered = useCallback(
    (task: DiscoveredTask) => {
      setSelectedConfig(task.id);
      runTask(task.command, task.id);
      setDropdownOpen(false);
    },
    [runTask, setSelectedConfig],
  );

  const handleDeleteTask = useCallback(
    (e: React.MouseEvent, config: TaskConfig) => {
      e.stopPropagation();
      void deleteConfig(config.id, config.scope, projectPath ?? undefined);
    },
    [deleteConfig, projectPath],
  );

  const handleImportOne = useCallback(
    (e: React.MouseEvent, task: DiscoveredTask) => {
      e.stopPropagation();
      if (!projectPath) return;
      void importDiscovered(task, projectPath, activeProject?.id);
    },
    [importDiscovered, projectPath, activeProject?.id],
  );

  const handleImportAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!projectPath || discovered.length === 0) return;
      void importAllDiscovered(projectPath, activeProject?.id);
    },
    [importAllDiscovered, projectPath, activeProject?.id, discovered.length],
  );

  const handleOpenAddDialog = useCallback(() => {
    setEditingConfig(null);
    setDropdownOpen(false);
    setDialogOpen(true);
  }, []);

  const handleOpenEditDialog = useCallback(
    (e: React.MouseEvent, config: TaskConfig) => {
      e.stopPropagation();
      setEditingConfig(config);
      setDropdownOpen(false);
      setDialogOpen(true);
    },
    [],
  );

  const handleDialogSubmit = useCallback(
    (name: string, command: string) => {
      if (editingConfig) {
        const updated: TaskConfig = {
          ...editingConfig,
          name: name || command,
          command,
        };
        void updateConfig(updated, projectPath ?? undefined);
      } else {
        const config: TaskConfig = {
          id: crypto.randomUUID(),
          name: name || command,
          command,
          scope: "project",
          project_id: activeProject?.id,
        };
        void addConfig(config, projectPath ?? undefined);
      }
      setDialogOpen(false);
      setEditingConfig(null);
    },
    [editingConfig, activeProject, projectPath, addConfig, updateConfig],
  );

  const discoveredByGroup = useMemo(() => {
    const map = new Map<string, DiscoveredTask[]>();
    for (const t of discovered) {
      const list = map.get(t.group) ?? [];
      list.push(t);
      map.set(t.group, list);
    }
    return map;
  }, [discovered]);

  const hasAny = configs.length > 0 || discovered.length > 0;

  return (
    <>
      <div className="relative flex items-center" ref={dropdownRef}>
        <div className="flex items-center h-5 rounded-md hover:bg-bg-hover transition-colors">
          <button
            className={`flex items-center gap-1.5 pl-1.5 pr-2 h-full text-text-primary transition-colors cursor-pointer ${!canRun ? "opacity-50" : ""}`}
            onClick={handlePlayStop}
            title={
              isRunning
                ? "Stop task"
                : selectedLabel
                  ? `Run: ${selectedLabel}`
                  : "No task selected"
            }
            disabled={!canRun}
          >
            {isRunning ? (
              <Square size={13} className="text-accent-red shrink-0" fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={13} className="text-accent-green shrink-0" fill="currentColor" strokeWidth={0} />
            )}
            <span className="text-[var(--font-size)] text-text-secondary max-w-[100px] truncate">
              {selectedLabel ?? "Run"}
            </span>
          </button>

          <div className="w-px h-3.5 bg-border shrink-0" />

          <button
            className="flex items-center justify-center w-5 h-full text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            title="Task list"
          >
            <ChevronDown size={12} />
          </button>
        </div>

        {dropdownOpen && (
          <div className="absolute top-full right-0 mt-1.5 w-64 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden max-h-[min(420px,70vh)] flex flex-col">
            <div className="overflow-y-auto flex-1 min-h-0">
              {/* Saved tasks */}
              {configs.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-text-muted font-semibold">
                    Saved
                  </div>
                  {configs.map((config) => (
                    <div
                      key={config.id}
                      className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-hover"
                      onClick={() => handleSelectAndRunSaved(config)}
                    >
                      <Play size={12} className="shrink-0 text-accent-green" fill="currentColor" strokeWidth={0} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--font-size)] text-text-primary truncate">
                          {config.name}
                        </div>
                        <div className="text-[10px] text-text-muted truncate font-mono">
                          {config.command}
                        </div>
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary transition-opacity cursor-pointer"
                        onClick={(e) => handleOpenEditDialog(e, config)}
                        title="Edit task"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-red transition-opacity cursor-pointer"
                        onClick={(e) => handleDeleteTask(e, config)}
                        title="Delete task"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Discovered tasks (not yet imported) */}
              {discovered.length > 0 && (
                <div className="py-1 border-t border-border">
                  <div className="px-3 py-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-text-muted font-semibold">
                      Discovered
                    </span>
                    <button
                      type="button"
                      className="text-[10px] text-accent-blue hover:underline cursor-pointer"
                      onClick={handleImportAll}
                      title="Import all discovered tasks into project config"
                    >
                      Import all
                    </button>
                  </div>
                  {[...discoveredByGroup.entries()].map(([group, tasks]) => (
                    <div key={group}>
                      <div className="px-3 py-0.5 text-[10px] text-text-muted truncate">
                        {group}
                      </div>
                      {tasks.map((task) => (
                        <div
                          key={task.id}
                          className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-hover"
                          onClick={() => handleSelectAndRunDiscovered(task)}
                        >
                          <Play size={12} className="shrink-0 text-accent-green" fill="currentColor" strokeWidth={0} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[var(--font-size)] text-text-primary truncate">
                              {task.name}
                            </div>
                            <div className="text-[10px] text-text-muted truncate font-mono">
                              {task.command}
                            </div>
                          </div>
                          <button
                            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-blue transition-opacity cursor-pointer"
                            onClick={(e) => handleImportOne(e, task)}
                            title="Save to project tasks"
                          >
                            <Download size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {!hasAny && (
                <div className="px-3 py-2.5 text-[var(--font-size)] text-text-muted">
                  {discovering
                    ? "Scanning project for tasks…"
                    : "No tasks found. Add one or open a project with package.json scripts."}
                </div>
              )}
            </div>

            <div className="border-t border-border shrink-0">
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer"
                onClick={handleOpenAddDialog}
              >
                <Plus size={14} />
                <span>Add Task...</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {dialogOpen && (
        <TaskDialog
          onClose={() => {
            setDialogOpen(false);
            setEditingConfig(null);
          }}
          onSubmit={handleDialogSubmit}
          editConfig={editingConfig ?? undefined}
        />
      )}
    </>
  );
}

export default React.memo(TaskRunButton);
