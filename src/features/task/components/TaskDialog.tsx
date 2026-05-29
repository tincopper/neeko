import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@/shared/components/icons"
import type { TaskConfig } from "../../../types/task";

interface TaskDialogProps {
  onClose: () => void;
  onSubmit: (name: string, command: string) => void;
  editConfig?: TaskConfig;
}

function TaskDialog({ onClose, onSubmit, editConfig }: TaskDialogProps) {
  const isEdit = !!editConfig;
  const [name, setName] = useState(editConfig?.name ?? "");
  const [command, setCommand] = useState(editConfig?.command ?? "");

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    if (!command.trim()) return;
    onSubmit(name.trim(), command.trim());
  }, [name, command, onSubmit]);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[420px] bg-bg-secondary rounded-lg shadow-xl flex flex-col overflow-hidden">
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

        <div className="px-5 py-5 flex flex-col gap-4">
          <p className="text-[var(--font-size)] text-text-muted leading-relaxed">
            {isEdit
              ? "Update the task name and command."
              : "Create a shell task for this project."}
          </p>

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
        </div>

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

export default React.memo(TaskDialog);
