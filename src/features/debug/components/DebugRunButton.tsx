import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Square,
  ChevronDown,
  Bug,
  Plus,
  Pencil,
  X,
} from '@/shared/components/icons';

import { useProjectStore } from '@/features/project/store';
import { useEditorStore } from '@/shared/store';
import { useDebugStore } from '../store/debugStore';
import type { EntryPoint, LaunchConfig } from '../types';
import LaunchConfigDialog from './LaunchConfigDialog';

/** Active editor file path for ${file} / ${fileDirname} expansion. */
function getActiveEditorFile(projectId: string): string | null {
  const projectTabs = useEditorStore.getState().tabs[projectId];
  if (!projectTabs) return null;
  const active = projectTabs.tabs.find((t) => t.id === projectTabs.activeTabId);
  if (active?.data.kind === 'file') return active.data.filePath;
  const fileTab = projectTabs.tabs.find((t) => t.data.kind === 'file');
  return fileTab?.data.kind === 'file' ? fileTab.data.filePath : null;
}

function DebugRunButton() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LaunchConfig | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeProject = useProjectStore((s) => s.activeProject);
  const projectId = activeProject?.id ?? null;
  const projectName = activeProject?.name ?? activeProject?.path?.split(/[/\\]/).pop();

  const {
    configs,
    entries,
    selectedConfigName,
    session,
    loadConfigs,
    selectConfig,
    addConfig,
    updateConfig,
    deleteConfig,
    start,
    debugEntry,
    runEntry,
    stop,
    subscribeEvents,
    clearError,
  } = useDebugStore();

  useEffect(() => {
    if (!projectId) return;
    void loadConfigs(projectId);
  }, [projectId, loadConfigs]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void subscribeEvents().then((u) => {
      if (cancelled) {
        u();
        return;
      }
      unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [subscribeEvents]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const isActive =
    !!session?.sessionId &&
    session.status !== 'terminated' &&
    session.status !== 'ended';
  const selectedConfig = configs.find((c) => c.name === selectedConfigName);
  // Can start with a config OR discovered entries (auto-resolve on start)
  const canStart = !!projectId && !isActive && (configs.length > 0 || entries.length > 0);

  const handlePlayStop = useCallback(async () => {
    if (!projectId) return;
    clearError();
    if (isActive) {
      await stop();
      return;
    }
    try {
      const currentFile = getActiveEditorFile(projectId);
      await start(projectId, currentFile);
    } catch {
      // error in store + console
    }
  }, [projectId, isActive, stop, start, clearError]);

  const handleSelect = useCallback(
    (name: string) => {
      selectConfig(name);
      setDropdownOpen(false);
    },
    [selectConfig],
  );

  const handleDebugEntry = useCallback(
    async (entry: EntryPoint) => {
      if (!projectId) return;
      setDropdownOpen(false);
      clearError();
      try {
        await debugEntry(projectId, entry, getActiveEditorFile(projectId));
      } catch {
        // stored
      }
    },
    [projectId, debugEntry, clearError],
  );

  const handleRunEntry = useCallback(
    (e: React.MouseEvent, entry: EntryPoint) => {
      e.stopPropagation();
      setDropdownOpen(false);
      runEntry(entry);
    },
    [runEntry],
  );

  const handleOpenAdd = useCallback(() => {
    setEditingConfig(null);
    setDropdownOpen(false);
    setDialogOpen(true);
  }, []);

  const handleOpenEdit = useCallback((e: React.MouseEvent, config: LaunchConfig) => {
    e.stopPropagation();
    setEditingConfig(config);
    setDropdownOpen(false);
    setDialogOpen(true);
  }, []);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, config: LaunchConfig) => {
      e.stopPropagation();
      if (!projectId) return;
      try {
        await deleteConfig(projectId, config.name);
      } catch {
        // error in store
      }
    },
    [projectId, deleteConfig],
  );

  const handleDialogSubmit = useCallback(
    async (config: LaunchConfig) => {
      if (!projectId) return;
      try {
        if (editingConfig) {
          await updateConfig(projectId, editingConfig.name, config);
        } else {
          await addConfig(projectId, config);
        }
        setDialogOpen(false);
        setEditingConfig(null);
      } catch {
        // keep dialog open
      }
    },
    [projectId, editingConfig, addConfig, updateConfig],
  );

  const label =
    selectedConfig?.name ??
    entries[0]?.configName ??
    (isActive ? session?.configName : null) ??
    'Debug';

  return (
    <>
      <div className="relative flex items-center gap-0.5" ref={dropdownRef}>
        <div className="flex items-center h-5 rounded-md hover:bg-bg-hover transition-colors">
          <button
            className={`flex items-center gap-1.5 pl-1.5 pr-2 h-full text-text-primary transition-colors cursor-pointer ${
              !canStart && !isActive ? 'opacity-50' : ''
            }`}
            onClick={() => void handlePlayStop()}
            title={
              isActive
                ? 'Stop debugging'
                : selectedConfig
                  ? `Debug: ${selectedConfig.name}`
                  : entries.length > 0
                    ? `Debug entry: ${entries[0].name}`
                    : 'No entry points — open menu to add a config'
            }
            disabled={!canStart && !isActive}
          >
            {isActive ? (
              <Square
                size={13}
                className="text-accent-red shrink-0"
                fill="currentColor"
                strokeWidth={0}
              />
            ) : (
              <Bug size={13} className="text-accent-blue shrink-0" />
            )}
            <span className="text-[var(--font-size)] text-text-secondary max-w-[100px] truncate">
              {label}
            </span>
          </button>

          <div className="w-px h-3.5 bg-border shrink-0" />

          <button
            className="flex items-center justify-center w-5 h-full text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            title="Launch configurations & entries"
          >
            <ChevronDown size={12} />
          </button>
        </div>

        {dropdownOpen && (
          <div className="absolute top-full right-0 mt-1.5 w-80 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden">
            {entries.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wide">
                  Application entries
                </div>
                <div className="pb-1 max-h-48 overflow-y-auto">
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="group flex items-center gap-1 px-2 py-1.5 hover:bg-bg-hover"
                    >
                      <button
                        type="button"
                        className="flex-1 min-w-0 flex items-center gap-2 px-1 py-0.5 text-left cursor-pointer"
                        onClick={() => void handleDebugEntry(entry)}
                        title={`Debug ${entry.name}`}
                      >
                        <Bug size={12} className="shrink-0 text-accent-blue" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[var(--font-size)] text-text-primary truncate">
                            {entry.name}
                          </div>
                          <div className="text-[10px] text-text-muted truncate">
                            {entry.language} · {entry.programTemplate}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-text-secondary hover:bg-bg-primary hover:text-accent-green cursor-pointer shrink-0"
                        title={`Run: ${entry.runCommand}`}
                        onClick={(e) => handleRunEntry(e, entry)}
                      >
                        <Play size={10} fill="currentColor" strokeWidth={0} />
                        Run
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-text-secondary hover:bg-bg-primary hover:text-accent-blue cursor-pointer shrink-0"
                        title={`Debug ${entry.name}`}
                        onClick={() => void handleDebugEntry(entry)}
                      >
                        <Bug size={10} />
                        Debug
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border" />
              </>
            )}

            {configs.length > 0 ? (
              <>
                <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wide">
                  Launch configs
                </div>
                <div className="pb-1 max-h-48 overflow-y-auto">
                  {configs.map((config) => (
                    <div
                      key={config.name}
                      className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-hover"
                      onClick={() => handleSelect(config.name)}
                    >
                      <Bug size={12} className="shrink-0 text-accent-blue" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--font-size)] text-text-primary truncate">
                          {config.name}
                        </div>
                        <div className="text-[10px] text-text-muted truncate">
                          {config.type} · {config.program ?? config.request}
                        </div>
                      </div>
                      {selectedConfigName === config.name && (
                        <span className="text-[10px] text-accent-green shrink-0">selected</span>
                      )}
                      <button
                        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary transition-opacity cursor-pointer shrink-0"
                        onClick={(e) => handleOpenEdit(e, config)}
                        title="Edit config"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-red transition-opacity cursor-pointer shrink-0"
                        onClick={(e) => void handleDelete(e, config)}
                        title="Delete config"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : entries.length === 0 ? (
              <div className="px-3 py-2.5 text-[var(--font-size)] text-text-muted">
                No launch configs or entry points found
              </div>
            ) : null}

            <div className="border-t border-border" />

            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer disabled:opacity-50"
              onClick={handleOpenAdd}
              disabled={!projectId}
              title={projectId ? 'Add launch configuration' : 'Select a project first'}
            >
              <Plus size={14} />
              <span>Add Config...</span>
            </button>
          </div>
        )}
      </div>

      {dialogOpen && (
        <LaunchConfigDialog
          onClose={() => {
            setDialogOpen(false);
            setEditingConfig(null);
          }}
          onSubmit={(config) => void handleDialogSubmit(config)}
          editConfig={editingConfig}
          projectName={projectName}
        />
      )}
    </>
  );
}

export default React.memo(DebugRunButton);
