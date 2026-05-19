import React, { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, ChevronDown, Plus, Pencil, X } from "lucide-react";
import { useTaskStore } from "../../store/taskStore";
import { useAppStore } from "../../store/appStore";
import TaskDialog from "./TaskDialog";
import type { TaskConfig } from "../../types/task";

// ── TaskRunButton ────────────────────────────────────────────────────────────

function TaskRunButton() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<TaskConfig | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    configs,
    taskState,
    selectedConfigId,
    loadConfigs,
    addConfig,
    updateConfig,
    deleteConfig,
    runTask,
    stopTask,
    setSelectedConfig,
  } = useTaskStore();

  const activeProject = useAppStore((s) => s.activeProject);
  const projectPath = activeProject?.path ?? null;

  // Load configs when project changes
  useEffect(() => {
    loadConfigs(projectPath ?? undefined);
  }, [projectPath, loadConfigs]);

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

  const isRunning = taskState.status === "running";
  const canRun = isRunning || !!selectedConfigId;
  const selectedConfig = configs.find((c) => c.id === selectedConfigId);

  const handlePlayStop = useCallback(() => {
    if (isRunning) { stopTask(); return; }
    const config = configs.find((c) => c.id === selectedConfigId);
    if (config) runTask(config.command, config.id);
  }, [isRunning, configs, selectedConfigId, runTask, stopTask]);

  const handleSelectAndRun = useCallback(
    (config: TaskConfig) => {
      setSelectedConfig(config.id);
      runTask(config.command, config.id);
      setDropdownOpen(false);
    },
    [runTask, setSelectedConfig],
  );

  const handleDeleteTask = useCallback(
    (e: React.MouseEvent, config: TaskConfig) => {
      e.stopPropagation();
      deleteConfig(config.id, config.scope, projectPath ?? undefined);
    },
    [deleteConfig, projectPath],
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
        // Edit mode — update existing config preserving id + scope
        const updated: TaskConfig = {
          ...editingConfig,
          name: name || command,
          command,
        };
        updateConfig(updated, projectPath ?? undefined);
      } else {
        // Add mode — create new config
        const config: TaskConfig = {
          id: crypto.randomUUID(),
          name: name || command,
          command,
          scope: "project",
          project_id: activeProject?.id,
        };
        addConfig(config, projectPath ?? undefined);
      }
      setDialogOpen(false);
      setEditingConfig(null);
    },
    [editingConfig, activeProject, projectPath, addConfig, updateConfig],
  );

  return (
    <>
      <div className="relative flex items-center" ref={dropdownRef}>
        {/* Run widget */}
        <div className="flex items-center h-7 rounded-md hover:bg-bg-hover transition-colors">
          {/* Play / Stop button */}
          <button
            className={`flex items-center gap-1.5 pl-1.5 pr-2 h-full text-text-primary transition-colors cursor-pointer ${!canRun ? "opacity-50" : ""}`}
            onClick={handlePlayStop}
            title={isRunning ? "Stop task" : selectedConfig ? `Run: ${selectedConfig.name}` : "No task selected"}
            disabled={!canRun}
          >
            {isRunning ? (
              <Square size={13} className="text-accent-red shrink-0" fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={13} className="text-accent-green shrink-0" fill="currentColor" strokeWidth={0} />
            )}
            <span className="text-[var(--font-size)] text-text-secondary max-w-[100px] truncate">
              {selectedConfig ? selectedConfig.name : "Run"}
            </span>
          </button>

          {/* Separator */}
          <div className="w-px h-3.5 bg-border shrink-0" />

          {/* Dropdown arrow */}
          <button
            className="flex items-center justify-center w-5 h-full text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            title="Task list"
          >
            <ChevronDown size={12} />
          </button>
        </div>

        {/* Dropdown menu */}
        {dropdownOpen && (
          <div className="absolute top-full right-0 mt-1.5 w-56 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden">
            {configs.length > 0 && (
              <div className="py-1">
                {configs.map((config) => (
                  <div
                    key={config.id}
                    className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-hover"
                    onClick={() => handleSelectAndRun(config)}
                  >
                    <Play size={12} className="shrink-0 text-accent-green" fill="currentColor" strokeWidth={0} />
                    <span className="flex-1 text-[var(--font-size)] text-text-primary truncate">
                      {config.name}
                    </span>
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

            {configs.length === 0 && (
              <div className="px-3 py-2.5 text-[var(--font-size)] text-text-muted">
                No tasks configured
              </div>
            )}

            <div className="border-t border-border" />

            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer"
              onClick={handleOpenAddDialog}
            >
              <Plus size={14} />
              <span>Add Task...</span>
            </button>
          </div>
        )}
      </div>

      {/* Task Dialog (Add / Edit) — rendered at body level via portal */}
      {dialogOpen && (
        <TaskDialog
          onClose={() => { setDialogOpen(false); setEditingConfig(null); }}
          onSubmit={handleDialogSubmit}
          editConfig={editingConfig ?? undefined}
        />
      )}
    </>
  );
}

export default React.memo(TaskRunButton);
