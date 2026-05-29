import React, { useCallback, useRef, useState } from "react";
import type { AppConfig } from "../../../types";
import {
  SHORTCUT_ACTIONS,
  resolveBindings,
  findConflicts,
  formatBinding,
  captureBinding,
  isSwitchProjectBinding,
  type ConflictEntry,
} from '@/shared/utils/shortcutRegistry';

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight",
  "ShiftLeft", "ShiftRight",
  "AltLeft", "AltRight",
  "MetaLeft", "MetaRight",
  "OSLeft", "OSRight",
]);

function isModifierKey(e: React.KeyboardEvent): boolean {
  return MODIFIER_CODES.has(e.nativeEvent.code);
}

interface ShortcutPanelProps {
  config: AppConfig;
  onConfigChange: (next: AppConfig) => void;
}

function conflictForAction(conflicts: ConflictEntry[], actionId: string): string[] | null {
  for (const entry of conflicts) {
    if (entry.actions.includes(actionId)) {
      return entry.actions.filter((a) => a !== actionId && SHORTCUT_ACTIONS.some((s) => s.id === a));
    }
  }
  return null;
}

const ShortcutPanel: React.FC<ShortcutPanelProps> = ({ config, onConfigChange }) => {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const recordingRef = useRef<HTMLDivElement>(null);

  const bindings = resolveBindings(config.shortcuts);
  const conflicts = findConflicts(bindings);

  const isOverridden = (id: string) => {
    const overrides = config.shortcuts;
    return overrides && overrides[id] !== undefined && overrides[id] !== SHORTCUT_ACTIONS.find((a) => a.id === id)?.defaultBinding;
  };

  const handleResetAll = useCallback(() => {
    onConfigChange({ ...config, shortcuts: {} });
  }, [config, onConfigChange]);

  const handleResetOne = useCallback(
    (id: string) => {
      const next = { ...config.shortcuts };
      delete next[id];
      onConfigChange({ ...config, shortcuts: next });
    },
    [config, onConfigChange],
  );

  const handleSelectRow = useCallback((id: string) => {
    if (recordingId) setRecordingId(null);
    setSelectedId(id);
  }, [recordingId]);

  const handleStartRecording = useCallback((id: string) => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
    if (action && isSwitchProjectBinding(action.defaultBinding)) {
      return;
    }
    setSelectedId(null);
    setRecordingId(id);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (recordingId) {
          setRecordingId(null);
        } else if (selectedId) {
          setSelectedId(null);
        }
        return;
      }

      if (!recordingId) {
        if (selectedId && e.key === "Enter") {
          e.preventDefault();
          handleStartRecording(selectedId);
        }
        return;
      }

      if (isModifierKey(e)) return;

      e.preventDefault();
      e.stopPropagation();

      const existing = SHORTCUT_ACTIONS.find((a) => a.id === recordingId);
      if (existing && isSwitchProjectBinding(existing.defaultBinding)) {
        setRecordingId(null);
        return;
      }

      const captured = captureBinding(e.nativeEvent);
      const formatted = formatBinding(captured);
      if (!formatted) return;

      onConfigChange({
        ...config,
        shortcuts: { ...config.shortcuts, [recordingId]: formatted },
      });
      setRecordingId(null);
    },
    [recordingId, config, onConfigChange],
  );

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">Keyboard Shortcuts</h3>
        <button
          className="px-3 py-1.5 text-[0.82em] rounded-md bg-bg-hover border border-border text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors"
          onClick={handleResetAll}
          disabled={Object.keys(config.shortcuts).length === 0}
        >
          Reset All
        </button>
      </div>

      <div className="text-[0.82em] text-text-muted mb-4">
        Click a shortcut to record a new key combination. Press Escape to cancel.
      </div>

      {conflicts.length > 0 && (
        <div className="mb-4 p-3 rounded-md bg-red-500/10 border border-red-500/30">
          {conflicts.map((entry) => {
            const actionLabels = entry.actions
              .map((id) => SHORTCUT_ACTIONS.find((a) => a.id === id)?.label ?? id)
              .join(", ");

            return (
              <div key={entry.binding} className="text-[0.82em] text-red-400">
                <strong>{entry.binding}</strong>: bound to {actionLabels}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-0.5" onKeyDown={handleKeyDown} tabIndex={-1} onClick={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}>
        {SHORTCUT_ACTIONS.map((action) => {
          const binding = bindings[action.id];
          if (!binding) return null;
          const isRecording = recordingId === action.id;
          const conflicting = conflictForAction(conflicts, action.id);
          const overridden = isOverridden(action.id);

          return (
            <div
              key={action.id}
              className={`flex items-center justify-between py-2.5 px-2 rounded-md cursor-pointer transition-colors group ${
                conflicting
                  ? "bg-red-500/5 hover:bg-red-500/10"
                  : overridden
                    ? "bg-yellow-500/5 hover:bg-yellow-500/10"
                    : selectedId === action.id
                      ? "bg-accent-blue/10 hover:bg-accent-blue/15"
                      : "hover:bg-bg-hover"
              }`}
              onClick={() => handleSelectRow(action.id)}
              onDoubleClick={() => handleStartRecording(action.id)}
              ref={isRecording ? recordingRef : undefined}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[0.84em] text-text-primary font-medium">{action.label}</div>
                {conflicting && (
                  <div className="text-[0.78em] text-red-400 mt-0.5">
                    Also bound to: {conflicting.map((id) => SHORTCUT_ACTIONS.find((a) => a.id === id)?.label ?? id).join(", ")}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isRecording ? (
                  <div
                    className={`px-2.5 py-1 rounded text-[0.82em] font-mono ${
                      conflicting
                        ? "bg-red-500/20 text-red-300 border border-red-500/40"
                        : "bg-accent-blue/20 text-accent-blue border border-accent-blue/40"
                    }`}
                  >
                    Press keys...
                  </div>
                ) : (
                  <div
                    className={`px-2.5 py-1 rounded text-[0.82em] font-mono ${
                      conflicting
                        ? "bg-red-500/10 text-red-300"
                        : overridden
                          ? "bg-yellow-500/10 text-yellow-300"
                          : "bg-bg-hover text-text-secondary"
                    }`}
                  >
                    {binding}
                  </div>
                )}

                {overridden && (
                  <button
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-all text-[0.72em]"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleResetOne(action.id);
                    }}
                    title="Reset to default"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default React.memo(ShortcutPanel);
