import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';

import ActionPalette from '@/features/action-menu/components/ActionPalette';
import SaveFileDialog from '@/features/action-menu/components/SaveFileDialog';
import type { ActionRegistryItem, ActionContext } from '@/features/action-menu/types/actionMenu';
import { checkAgentsInstalled, setProjectAgents } from '@/features/agent/api/agentApi';
import { useRemoteContext } from '@/features/connection/contexts/RemoteContext';
import EditorGroupLayout from '@/features/editor/components/EditorGroupLayout';
import { useFileDrop } from '@/features/file/hooks/useFileDrop';
import { useLibraryStore } from '@/features/library/store/libraryStore';
import { ProjectGuidePage } from '@/features/project/components/ProjectGuidePage';
import { useProjectActionsContext } from '@/features/project/ProjectContext';
import { useQuickOpenStore } from '@/features/quick-open/store/quickOpenStore';
import { useRecentFilesStore } from '@/features/quick-open/store/recentFilesStore';
import { terminalCache, terminalCacheKey } from '@/features/terminal/components/terminalCache';
import { sendToTerminal } from '@/features/terminal/components/terminalCommands';
import { KeyRound } from '@/shared/components/icons';
import { useEditorContext, useAppContext } from '@/shared/contexts';
import { useEditorStore } from '@/shared/store';
import { useConnectionStore } from '@/shared/store/connectionStore';
import { useDockStore } from '@/shared/store/dockStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { AgentConfig, Tab } from '@/shared/types';
import { createUntitledFileTab } from '@/shared/utils/createUntitledFileTab';
import { resolveTabKey } from '@/shared/utils/tabKey';
import { Button } from '@/ui/Button';

import { WelcomeScreen } from './WelcomeScreen';
const APP_SETTINGS_PROJECT_ID = '__app__';

// Module-level cache: `${projectId}::${agentId}` — status is environment-specific.
const agentInstalledCache = new Map<string, boolean>();

function agentInstallCacheKey(projectId: string | null, agentId: string): string {
  return `${projectId ?? '__none__'}::${agentId}`;
}

function ProjectWorkspace() {
  const { showToast } = useAppContext();
  const { onAddProject } = useProjectActionsContext();
  const { remoteAuthStore, activeRemoteWorktreePath, setRemoteOpenSessions, setPendingAuthEntry } =
    useRemoteContext();
  const { agents, onAgentClick } = useEditorContext();
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeWorktreePath = useWorktreeStore((state) => state.activeWorktreePath);

  // Determine the current project ID (all types via unified store)
  const currentProjectId = activeProject?.id ?? null;

  // Composite tab key: worktree gets its own independent tab space
  const tabKey = currentProjectId
    ? resolveTabKey(currentProjectId, activeWorktreePath)
    : APP_SETTINGS_PROJECT_ID;

  // Get unified tabs from store
  const projectTabs = useEditorStore(
    useShallow((state) => {
      if (!tabKey) return null;
      return state.tabs[tabKey] ?? null;
    }),
  );

  const tabs = projectTabs?.tabs ?? [];

  const hasActiveProject = !!activeProject;

  // Wire up file drag-to-agent: on dragend, paste the stored file path into
  // the agent terminal without auto-submitting (no \r).
  useFileDrop();

  const handleAddTerminalTab = useCallback(() => {
    if (!tabKey || !currentProjectId) return;
    const existingTabs = useEditorStore.getState().tabs[tabKey];
    const terminalCount = (existingTabs?.tabs ?? []).filter(
      (t) => t.data.kind === 'terminal',
    ).length;
    if (terminalCount >= 10) return;

    const tabId = `tab_${crypto.randomUUID()}`;
    const tab: Tab = {
      id: tabId,
      projectId: currentProjectId,
      title: `Terminal ${terminalCount + 1}`,
      order: existingTabs?.tabs.length ?? 0,
      data: {
        kind: 'terminal',
        agentId: null,
        status: 'Idle',
      },
    };
    useEditorStore.getState().addTab(tabKey, tab);
    useEditorStore.getState().activateTab(tabKey, tabId);
  }, [tabKey, currentProjectId]);

  // Agent installed status — re-check when agents or active project change
  // (Local / WSL / SSH each have their own PATH).
  const agentIdFingerprint = useMemo(
    () =>
      agents
        .map((a) => a.id)
        .sort()
        .join(','),
    [agents],
  );
  // Seed installed status from cache when agents change
  const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    // Defer to avoid sync setState in effect (can trigger cascading renders)
    Promise.resolve().then(() => {
      const ids = agents.map((a) => a.id);
      const allCached = ids.every((id) =>
        agentInstalledCache.has(agentInstallCacheKey(currentProjectId, id)),
      );
      if (allCached) {
        const map = new Map<string, boolean>();
        for (const id of ids) {
          map.set(id, agentInstalledCache.get(agentInstallCacheKey(currentProjectId, id)) ?? true);
        }
        setInstalledMap(map);
      } else {
        setInstalledMap(new Map());
      }
    });
  }, [agentIdFingerprint, currentProjectId, agents]);

  useEffect(() => {
    const ids = agents.map((a) => a.id);
    if (ids.length === 0) return;

    const missing = ids.filter(
      (id) => !agentInstalledCache.has(agentInstallCacheKey(currentProjectId, id)),
    );
    if (missing.length === 0) return;

    checkAgentsInstalled(missing, currentProjectId)
      .then((result) => {
        for (const [id, installed] of Object.entries(result)) {
          agentInstalledCache.set(agentInstallCacheKey(currentProjectId, id), installed);
        }
        const map = new Map<string, boolean>();
        for (const id of ids) {
          map.set(id, agentInstalledCache.get(agentInstallCacheKey(currentProjectId, id)) ?? true);
        }
        setInstalledMap(map);
      })
      .catch((err) => console.error('[ProjectWorkspace] Failed to check agents installed:', err));
  }, [agentIdFingerprint, currentProjectId, agents]);

  const handleAgentClick = useCallback(
    (agent: AgentConfig) => {
      const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
      if (!installed) {
        showToast(`${agent.name} (${agent.command}) is not installed`, 'error');
        return false;
      }
      if (!agent.enabled) return false;
      onAgentClick(agent);
      return true;
    },
    [installedMap, onAgentClick, showToast],
  );

  const selectedAgent = useMemo(() => {
    const agentId = activeProject?.selected_agents?.[0];
    if (!agentId) return null;
    return agents.find((a) => a.id === agentId) ?? null;
  }, [activeProject?.selected_agents, agents]);

  const handleGuideOpenTerminal = useCallback(() => {
    handleAddTerminalTab();
  }, [handleAddTerminalTab]);

  const handleGuideOpenAgent = useCallback(() => {
    if (!selectedAgent) return;
    handleAgentClick(selectedAgent);
  }, [selectedAgent, handleAgentClick]);

  const handleGuideNewFile = useCallback(() => {
    if (!tabKey || !currentProjectId) return;
    createUntitledFileTab(tabKey, currentProjectId);
  }, [tabKey, currentProjectId]);

  const handleSelectAgent = useCallback(
    (agent: AgentConfig) => {
      const opened = handleAgentClick(agent);
      if (opened && currentProjectId) {
        setProjectAgents(currentProjectId, [agent.id]).catch((err) => {
          console.error('[ProjectWorkspace] Failed to set project agent:', err);
        });
      }
    },
    [handleAgentClick, currentProjectId],
  );

  const buildLayoutId = useCallback((groupId: string, tabId: string | null) => {
    const p = useProjectStore.getState().activeProject;
    if (!p) return `none:${groupId}:${tabId ?? 'default'}`;
    const env = p.environment;
    let base: string;
    if (env.type === 'Wsl') {
      base = `wsl:${env.distro}:${p.id}`;
    } else if (env.type === 'Remote') {
      base = `remote:${env.host}:${p.id}`;
    } else {
      base = `local:${p.id}`;
    }
    return `${base}:${groupId}:${tabId ?? 'default'}`;
  }, []);

  // ── Action Palette ──
  const handlePaletteExecute = useCallback(
    (item: ActionRegistryItem) => {
      switch (item.id) {
        case 'new-terminal':
          handleAddTerminalTab();
          break;
        case 'open-file':
          useQuickOpenStore.getState().openPalette('gotoFile');
          break;
        case 'recent-files':
          useQuickOpenStore.getState().openPalette('recentFiles');
          break;
        case 'new-terminal-with-agent': {
          if (currentProjectId) {
            const enabled = agents.filter((a) => a.enabled);
            const first = enabled[0];
            if (first) {
              const tabId = `tab_${crypto.randomUUID()}`;
              useEditorStore.getState().addTab(tabKey, {
                id: tabId,
                projectId: currentProjectId,
                title: first.name,
                order: 0,
                data: {
                  kind: 'terminal' as const,
                  agentId: first.id,
                  status: 'Idle' as const,
                },
              });
              useEditorStore.getState().activateTab(tabKey, tabId);
            }
          }
          break;
        }
        case 'new-file': {
          if (currentProjectId) {
            createUntitledFileTab(tabKey, currentProjectId);
          }
          break;
        }
        case 'open-side-terminal':
          useDockStore.getState().togglePanel('projects');
          break;
        case 'open-in-ide': {
          if (activeProject) {
            useProjectStore
              .getState()
              .openIde({ id: activeProject.id, selected_ide: activeProject.selected_ide });
          }
          break;
        }
      }
    },
    [handleAddTerminalTab, activeProject, currentProjectId, tabKey, agents],
  );

  // Wire insert-to-agent-input for the library panel (set on window so the
  // dock panel wrapper can reach it without prop drilling through the layout).
  useEffect(() => {
    const w = window as unknown as { __neekoInsertToAgentInput?: (text: string) => void };
    w.__neekoInsertToAgentInput = (text: string) => {
      // Best-effort: emit an event the agent input listens to.
      window.dispatchEvent(new CustomEvent('neeko:insert-to-agent-input', { detail: { text } }));
    };
    return () => {
      delete (window as unknown as { __neekoInsertToAgentInput?: unknown })
        .__neekoInsertToAgentInput;
    };
  }, []);

  // ── Terminal PTY bridge ──────────────────────────────────────────────────
  // Expose helpers so the Library panel (rendered in the dock) can read the
  // current agent input and write to the active terminal without prop drilling.

  /** Read the current line from the active terminal (the "agent input"). */
  useEffect(() => {
    const w = window as unknown as { __neekoReadAgentInput?: () => string | null };
    w.__neekoReadAgentInput = () => {
      const editorState = useEditorStore.getState();
      const activeTabId = editorState.activeTabId;
      if (!activeTabId) return null;

      const proj = useProjectStore.getState();
      const activeProjectId = proj.activeProjectId;
      if (!activeProjectId) return null;

      // Resolve the terminal cache entry for the active tab.
      const cacheKey = terminalCacheKey(activeProjectId, activeTabId);
      const entry = terminalCache.get(cacheKey);
      if (!entry) {
        // Fallback: first terminal entry under this project.
        for (const [key, val] of terminalCache.entries()) {
          if (key.startsWith(`${activeProjectId}:`)) {
            const cursorY = val.term.buffer.active.cursorY;
            const baseY = val.term.buffer.active.baseY;
            const line = val.term.buffer.active.getLine(baseY + cursorY);
            return line?.translateToString().trim() ?? null;
          }
        }
        return null;
      }

      const cursorY = entry.term.buffer.active.cursorY;
      const baseY = entry.term.buffer.active.baseY;
      const line = entry.term.buffer.active.getLine(baseY + cursorY);
      return line?.translateToString().trim() ?? null;
    };
    return () => {
      delete (window as unknown as { __neekoReadAgentInput?: unknown }).__neekoReadAgentInput;
    };
  }, []);

  /** Write text to the active terminal's PTY (secondary insert target). */
  useEffect(() => {
    const w = window as unknown as { __neekoInsertToTerminal?: (text: string) => boolean };
    w.__neekoInsertToTerminal = (text: string) => {
      const editorState = useEditorStore.getState();
      const activeTabId = editorState.activeTabId;
      const proj = useProjectStore.getState();
      const activeProjectId = proj.activeProjectId;
      if (!activeProjectId) return false;
      try {
        sendToTerminal(activeProjectId, text, activeTabId);
        return true;
      } catch (err) {
        console.error('[ProjectWorkspace] __neekoInsertToTerminal failed:', err);
        return false;
      }
    };
    return () => {
      delete (window as unknown as { __neekoInsertToTerminal?: unknown }).__neekoInsertToTerminal;
    };
  }, []);

  const paletteCtx: ActionContext = useMemo(
    () => ({
      projectId: currentProjectId,
      tabKey,
      agents,
      recentFiles: currentProjectId
        ? useRecentFilesStore
            .getState()
            .list(currentProjectId)
            .map((r) => r.filePath)
        : [],
      closeMenu: () => {},
      insertToAgentInput: (text: string) => {
        window.dispatchEvent(new CustomEvent('neeko:insert-to-agent-input', { detail: { text } }));
      },
      openLibrary: (opts) => {
        const kind = opts?.kind ?? 'skill';
        useDockStore.getState().togglePanel('library');
        // Defer to next tick so the panel mounts before we set the kind.
        setTimeout(() => {
          if (kind === 'prompt') {
            useLibraryStore.getState().setActiveKind('prompt');
            useLibraryStore.getState().openInsert();
          }
        }, 50);
      },
    }),
    [currentProjectId, tabKey, agents],
  );

  const onRemoteSessionReady = useCallback(
    (pid: string) => {
      setRemoteOpenSessions((prev) => new Set(prev).add(pid));
    },
    [setRemoteOpenSessions],
  );

  // Remote project needs authentication but has no credentials yet
  const needsRemoteAuth = (() => {
    if (!activeProject || activeProject.environment.type !== 'Remote') return false;
    const env = activeProject.environment;
    const entry = useConnectionStore.getState().remoteEntries.find((e) => e.host === env.host);
    return !!entry && !remoteAuthStore.get(entry.id);
  })();

  const remoteProjectProp = useMemo(() => {
    if (!activeProject || activeProject.environment.type !== 'Remote') return null;
    const env = activeProject.environment;
    const entry = useConnectionStore.getState().remoteEntries.find((e) => e.host === env.host);
    if (!entry) return null;
    const auth = remoteAuthStore.get(entry.id);
    if (!auth) return null;
    const projectPath = activeRemoteWorktreePath ?? activeProject.path;
    const cacheKeySuffix = activeRemoteWorktreePath
      ? `:wt:${btoa(activeRemoteWorktreePath).replace(/=/g, '')}`
      : '';
    return {
      entryId: entry.id,
      projectId: activeProject.id,
      projectName: activeProject.name,
      projectPath,
      host: entry.host,
      port: entry.port,
      username: entry.username,
      auth,
      cacheKeySuffix,
      onSessionReady: onRemoteSessionReady,
    };
  }, [activeProject, remoteAuthStore, activeRemoteWorktreePath, onRemoteSessionReady]);

  return (
    <div className="main-content flex-1 flex flex-col overflow-hidden min-h-0 h-full">
      {needsRemoteAuth ? (
        <div className="empty-state flex-1 flex flex-col text-text-secondary">
          <div className="empty-body flex-1 flex flex-col items-center justify-center gap-4">
            <KeyRound
              className="h-[3.43em] w-[3.43em] text-text-muted opacity-60"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <h2 className="text-2xl font-semibold text-text-primary">Authentication required</h2>
            <Button
              variant="primary"
              onClick={() => {
                const p = useProjectStore.getState().activeProject;
                if (!p) return;
                const env = p.environment;
                if (env.type === 'Remote') {
                  const entry = useConnectionStore
                    .getState()
                    .remoteEntries.find((e) => e.host === env.host);
                  if (entry) setPendingAuthEntry(entry);
                }
              }}
              style={{ color: 'var(--text-on-accent)' }}
            >
              Enter Credentials
            </Button>
          </div>
        </div>
      ) : tabs.length > 0 ? (
        <EditorGroupLayout
          tabKey={tabKey}
          onAddTerminalTab={handleAddTerminalTab}
          remoteProject={remoteProjectProp}
          buildLayoutId={buildLayoutId}
        />
      ) : hasActiveProject && activeProject ? (
        <ProjectGuidePage
          projectId={activeProject.id}
          projectName={activeProject.name}
          projectPath={activeProject.path}
          selectedAgentIds={activeProject.selected_agents ?? []}
          selectedAgent={selectedAgent}
          worktreePath={activeWorktreePath}
          onOpenTerminal={handleGuideOpenTerminal}
          onOpenAgent={handleGuideOpenAgent}
          onNewFile={handleGuideNewFile}
          agents={agents}
          installedMap={installedMap}
          onSelectAgent={handleSelectAgent}
        />
      ) : !hasActiveProject ? (
        <WelcomeScreen onAddProject={onAddProject} />
      ) : null}

      <ActionPalette ctx={paletteCtx} onExecute={handlePaletteExecute} />
      <SaveFileDialog />
    </div>
  );
}

export default React.memo(ProjectWorkspace);
