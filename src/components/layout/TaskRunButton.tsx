import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play, Square, ChevronDown, Plus, X, Pencil } from "lucide-react";
import { useTaskStore } from "../../store/taskStore";
import { useAppStore } from "../../store/appStore";
import type { TaskConfig } from "../../types/task";

// ── Task Dialog (Add / Edit) ─────────────────────────────────────────────────

interface TaskDialogProps {
  onClose: () => void;
  onSubmit: (name: string, command: string, autoRun: boolean) => void;
  /** When provided, dialog operates in edit mode with pre-filled values */
  editConfig?: TaskConfig;
}

function TaskDialog({ onClose, onSubmit, editConfig }: TaskDialogProps) {
  const isEdit = !!editConfig;
  const [name, setName] = useState(editConfig?.name ?? "");
  const [command, setCommand] = useState(editConfig?.command ?? "");
  const [autoRun, setAutoRun] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    if (!command.trim()) return;
    onSubmit(name.trim(), command.trim(), autoRun);
  }, [name, command, autoRun, onSubmit]);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[420px] bg-bg-secondary rounded-lg shadow-xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="text-[15px] font-semibold text-text-primary">
            {isEdit ? "Edit Task" : "Add Task"}
          </h3>
          <button
            className="text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            onClick={onClose}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5 flex flex-col gap-4">
          <p className="text-[var(--font-size)] text-text-muted leading-relaxed">
            {isEdit
              ? "Update the task name and command."
              : "Create a shell task and configure how it should be saved and run."}
          </p>

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[var(--font-size)] font-medium text-text-secondary">
              Name
            </label>
            <input
              type="text"
              placeholder="Enter a name for this task (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 text-[var(--font-size)] rounded-md bg-bg-primary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
              autoFocus
            />
          </div>

          {/* Command */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[var(--font-size)] font-medium text-text-secondary">
              Command
            </label>
            <input
              type="text"
              placeholder="Enter command (for example, npm run dev)"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="w-full px-3 py-2.5 text-[var(--font-size)] rounded-md bg-bg-primary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            />
          </div>

          {/* Auto-run checkbox — only shown in add mode */}
          {!isEdit && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(e) => setAutoRun(e.target.checked)}
                className="w-4 h-4 mt-0.5 shrink-0 accent-accent-blue cursor-pointer"
              />
              <span className="text-[var(--font-size)] text-text-secondary leading-snug">
                Automatically run this task when the session worktree is created
              </span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2.5 px-5 py-3.5 border-t border-border">
          <button
            className="px-4 py-2 text-[var(--font-size)] rounded-md bg-bg-tertiary text-text-secondary hover:bg-bg-hover transition-colors cursor-pointer"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-[var(--font-size)] font-medium rounded-md bg-bg-hover text-text-primary hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
            onClick={handleSubmit}
            disabled={!command.trim()}
          >
            {isEdit ? "Save Changes" : "Add Task"}
          </button>
        </div>

      </div>
    </div>,
    document.body,
  );
}

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
    (name: string, command: string, _autoRun: boolean) => {
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
