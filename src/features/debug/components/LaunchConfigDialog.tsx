import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@/shared/components/icons';

import type { LaunchConfig } from '../types';

interface LaunchConfigDialogProps {
  onClose: () => void;
  onSubmit: (config: LaunchConfig) => void;
  editConfig?: LaunchConfig | null;
  /** Used to prefill program path suggestions */
  projectName?: string;
}

const TYPES = [
  { value: 'lldb', label: 'Rust (lldb / lldb-dap)' },
  { value: 'go', label: 'Go (delve / dlv dap)' },
] as const;

function defaultProgram(type: string, projectName?: string): string {
  if (type === 'go') {
    // Prefer common layout main under cmd/<name>; root often has no .go files.
    const bin = projectName || 'app';
    return `\${workspaceFolder}/cmd/${bin}`;
  }
  const bin = projectName || 'app';
  return `\${workspaceFolder}/target/debug/${bin}`;
}

function LaunchConfigDialog({
  onClose,
  onSubmit,
  editConfig,
  projectName,
}: LaunchConfigDialogProps) {
  const isEdit = !!editConfig;
  const [name, setName] = useState(editConfig?.name ?? '');
  const [type, setType] = useState(editConfig?.type ?? 'lldb');
  const [program, setProgram] = useState(
    editConfig?.program ?? defaultProgram(editConfig?.type ?? 'lldb', projectName),
  );
  const [cwd, setCwd] = useState(editConfig?.cwd ?? '${workspaceFolder}');
  const [argsText, setArgsText] = useState((editConfig?.args ?? []).join(' '));
  const [mode, setMode] = useState(editConfig?.mode ?? 'debug');
  const [preLaunchTask, setPreLaunchTask] = useState(editConfig?.preLaunchTask ?? '');
  const [stopOnEntry, setStopOnEntry] = useState(editConfig?.stopOnEntry ?? true);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleTypeChange = useCallback(
    (next: string) => {
      setType(next);
      // Only auto-fill program when adding or program still looks like a default
      if (!isEdit || !editConfig?.program) {
        setProgram(defaultProgram(next, projectName));
      }
      if (next === 'go' && !mode) setMode('debug');
    },
    [isEdit, editConfig?.program, projectName, mode],
  );

  const handleSubmit = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const args = argsText
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const config: LaunchConfig = {
      name: trimmedName,
      type,
      request: 'launch',
      program: program.trim() || null,
      cwd: cwd.trim() || '${workspaceFolder}',
      args,
      mode: type === 'go' ? mode || 'debug' : null,
      preLaunchTask: preLaunchTask.trim() || null,
      stopOnEntry,
    };
    onSubmit(config);
  }, [name, type, program, cwd, argsText, mode, preLaunchTask, stopOnEntry, onSubmit]);

  const canSubmit = name.trim().length > 0 && (type === 'go' || program.trim().length > 0);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[480px] max-h-[90vh] bg-bg-secondary rounded-lg shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="text-[15px] font-semibold text-text-primary">
            {isEdit ? 'Edit Launch Config' : 'Add Launch Config'}
          </h3>
          <button
            className="text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            onClick={onClose}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4 overflow-y-auto">
          <p className="text-[var(--font-size)] text-text-muted leading-relaxed">
            Saved to <code className="text-text-secondary">.neeko/launch.json</code> in the
            project root. Use variables like{' '}
            <code className="text-text-secondary">${'{workspaceFolder}'}</code>,{' '}
            <code className="text-text-secondary">${'{fileDirname}'}</code>.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-[var(--font-size)] font-medium text-text-secondary">Name</label>
            <input
              type="text"
              placeholder="e.g. Debug main binary"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 text-[var(--font-size)] rounded-md bg-bg-primary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[var(--font-size)] font-medium text-text-secondary">Type</label>
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="w-full px-3 py-2.5 text-[var(--font-size)] rounded-md bg-bg-primary border border-border text-text-primary focus:outline-none focus:border-accent-blue transition-colors cursor-pointer"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[var(--font-size)] font-medium text-text-secondary">
              Program {type === 'lldb' ? '(binary path)' : '(package with main)'}
            </label>
            <input
              type="text"
              placeholder={
                type === 'go'
                  ? '${workspaceFolder}/cmd/app  or  ${fileDirname}'
                  : '${workspaceFolder}/target/debug/app'
              }
              value={program}
              onChange={(e) => setProgram(e.target.value)}
              className="w-full px-3 py-2.5 text-[var(--font-size)] rounded-md bg-bg-primary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors font-mono text-[13px]"
            />
            {type === 'go' ? (
              <p className="text-[11px] text-text-muted leading-relaxed">
                Must point to a directory that contains <code className="text-text-secondary">.go</code>{' '}
                files (usually <code className="text-text-secondary">cmd/…</code>). Module root only
                works when it has a <code className="text-text-secondary">main</code> package.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[var(--font-size)] font-medium text-text-secondary">
              Working directory
            </label>
            <input
              type="text"
              placeholder="${workspaceFolder}"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="w-full px-3 py-2.5 text-[var(--font-size)] rounded-md bg-bg-primary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors font-mono text-[13px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[var(--font-size)] font-medium text-text-secondary">
              Arguments (space-separated)
            </label>
            <input
              type="text"
              placeholder="--flag value"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              className="w-full px-3 py-2.5 text-[var(--font-size)] rounded-md bg-bg-primary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors font-mono text-[13px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
            />
          </div>

          {type === 'go' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[var(--font-size)] font-medium text-text-secondary">
                Mode
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full px-3 py-2.5 text-[var(--font-size)] rounded-md bg-bg-primary border border-border text-text-primary focus:outline-none focus:border-accent-blue transition-colors cursor-pointer"
              >
                <option value="debug">debug</option>
                <option value="test">test</option>
                <option value="exec">exec</option>
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[var(--font-size)] font-medium text-text-secondary">
              preLaunchTask (optional shell command)
            </label>
            <input
              type="text"
              placeholder="e.g. cargo build"
              value={preLaunchTask}
              onChange={(e) => setPreLaunchTask(e.target.value)}
              className="w-full px-3 py-2.5 text-[var(--font-size)] rounded-md bg-bg-primary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors font-mono text-[13px]"
            />
            <p className="text-[11px] text-text-muted">
              Runs in the project environment before starting the debugger.
            </p>
          </div>

          <label className="flex items-center gap-2 text-[var(--font-size)] text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={stopOnEntry}
              onChange={(e) => setStopOnEntry(e.target.checked)}
              className="rounded border-border"
            />
            Stop on entry
            <span className="text-[11px] text-text-muted">
              (recommended — pause before main runs)
            </span>
          </label>
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
            disabled={!canSubmit}
          >
            {isEdit ? 'Save Changes' : 'Add Config'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default React.memo(LaunchConfigDialog);
