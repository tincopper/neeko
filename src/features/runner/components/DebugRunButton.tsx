import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Square, ChevronDown, Bug } from '@/shared/components/icons';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { useDebugSessionLifecycle } from '../hooks/useDebugSessionLifecycle';
import { useVisibleDebugSession } from '../hooks/useVisibleDebugSession';
import { useDebugStore } from '../store/debugStore';
import type { EntryPoint, LaunchConfig } from '../types';

import DebugRunDropdown from './DebugRunDropdown';
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
  // 项目切换时释放旧项目会话（常驻挂载点：title bar）。
  useDebugSessionLifecycle();
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
  // 启动/停止判定只认当前项目会话：跨项目残留会话不得让本项目的按钮误判为「运行中」（#14）。
  const session = useVisibleDebugSession();

  useEffect(() => {
    if (!projectId) return;
    void loadConfigs(projectId);
  }, [projectId, loadConfigs]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void subscribeEvents().then((u) => {
      if (cancelled) {
        safeUnlisten(u)();
        return;
      }
      unlisten = safeUnlisten(u);
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
    !!session?.sessionId && session.status !== 'terminated' && session.status !== 'ended';
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
          <DebugRunDropdown
            entries={entries}
            configs={configs}
            selectedConfigName={selectedConfigName}
            canAdd={!!projectId}
            onSelect={handleSelect}
            onDebugEntry={(entry) => void handleDebugEntry(entry)}
            onRunEntry={handleRunEntry}
            onEdit={handleOpenEdit}
            onDelete={(e, config) => void handleDelete(e, config)}
            onAdd={handleOpenAdd}
          />
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
