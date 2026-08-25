import React, { useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/shallow';

import { useProjectAgents } from '@/app/hooks/useProjectAgents';
import { useRemoteProjectSession } from '@/app/hooks/useRemoteProjectSession';
import { useTerminalTabs } from '@/app/hooks/useTerminalTabs';
import { buildLayoutId } from '@/app/utils/layoutId';
import { ActionPalette, SaveFileDialog } from '@/features/action-menu';
import type { ActionRegistryItem, ActionContext } from '@/features/action-menu/types/actionMenu';
import { setProjectAgents } from '@/features/agent/api/agentApi';
import { useRemoteContext } from '@/features/connection';
import { EditorGroupLayout } from '@/features/editor';
import { useFileDrop } from '@/features/file';
import { useLibraryStore } from '@/features/library/store/libraryStore';
import { ProjectGuidePage } from '@/features/project';
import { useProjectActionsContext } from '@/features/project/ProjectContext';
import { useQuickOpenStore } from '@/features/quick-open/store/quickOpenStore';
import { useRecentFilesStore } from '@/features/quick-open/store/recentFilesStore';
import { sendToTerminal } from '@/features/terminal';
import { KeyRound } from '@/shared/components/icons';
import { useEditorContext, useAppContext, useTerminalInsert } from '@/shared/contexts';
import { INSERT_TO_AGENT_INPUT_EVENT } from '@/shared/events';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { AgentConfig } from '@/shared/types';
import { createUntitledFileTab } from '@/shared/utils/createUntitledFileTab';
import { resolveTabKey } from '@/shared/utils/tabKey';
import { Button } from '@/ui/Button';

import { WelcomeScreen } from './WelcomeScreen';
const APP_SETTINGS_PROJECT_ID = '__app__';

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

  const { handleAddTerminalTab } = useTerminalTabs(tabKey, currentProjectId);

  // Agent installed status — re-check when agents or active project change
  // (Local / WSL / SSH each have their own PATH).
  const { installedMap, handleAgentClick } = useProjectAgents({
    agents,
    projectId: currentProjectId,
    showToast,
    onAgentClick,
  });

  const { needsRemoteAuth, remoteProjectProp, handleEnterCredentials } = useRemoteProjectSession({
    activeProject,
    remoteAuthStore,
    activeRemoteWorktreePath,
    setRemoteOpenSessions,
    setPendingAuthEntry,
  });

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

  const handleGuideOpenAgentChat = useCallback(() => {
    if (!tabKey || !currentProjectId) return;
    const tabId = `tab_${crypto.randomUUID()}`;
    const tabs = useEditorStore.getState().tabs[tabKey]?.tabs ?? [];
    useEditorStore.getState().addTab(tabKey, {
      id: tabId,
      projectId: currentProjectId,
      title: 'Agent Chat',
      order: tabs.length,
      data: {
        kind: 'agent-chat' as const,
        agentId: undefined,
        sessionId: undefined,
      },
    });
    useEditorStore.getState().activateTab(tabKey, tabId);
  }, [tabKey, currentProjectId]);

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

  const handleBuildLayoutId = useCallback(
    (groupId: string, tabId: string | null) => buildLayoutId(activeProject, groupId, tabId),
    [activeProject],
  );

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
    [handleAddTerminalTab, activeProject, currentProjectId, tabKey],
  );

  // ── Terminal / agent-input 插入能力注册 ─────────────────────────────────
  // 通过 TerminalInsertContext 向 dock 面板（LibraryPanel 等）暴露插入能力，
  // 替代此前的 window 全局函数桥接（__neekoInsertTo*）：显式类型契约 +
  // 挂载/卸载生命周期管理。
  const { register } = useTerminalInsert();

  useEffect(() => {
    const unregister = register({
      // Best-effort: emit an event the agent input listens to.
      insertToAgentInput: (text: string) => {
        window.dispatchEvent(new CustomEvent(INSERT_TO_AGENT_INPUT_EVENT, { detail: { text } }));
      },
      /** Write text to the active terminal's PTY (secondary insert target). */
      insertToTerminal: (text: string) => {
        const editorState = useEditorStore.getState();
        const activeTabId = editorState.activeTabId;
        const proj = useProjectStore.getState();
        const activeProjectId = proj.activeProjectId;
        if (!activeProjectId) return false;
        try {
          sendToTerminal(activeProjectId, text, activeTabId);
          return true;
        } catch (err) {
          console.error('[ProjectWorkspace] insertToTerminal failed:', err);
          return false;
        }
      },
    });
    return unregister;
  }, [register]);

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
        window.dispatchEvent(new CustomEvent(INSERT_TO_AGENT_INPUT_EVENT, { detail: { text } }));
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
              onClick={handleEnterCredentials}
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
          buildLayoutId={handleBuildLayoutId}
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
          onOpenAgentChat={handleGuideOpenAgentChat}
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
