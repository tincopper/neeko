import React, { useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/shallow';

import { useMoveTabToSlot } from '@/app/hooks/useMoveTabToSlot';
import { useProjectAgents } from '@/app/hooks/useProjectAgents';
import { useRemoteProjectSession } from '@/app/hooks/useRemoteProjectSession';
import { useTerminalTabs } from '@/app/hooks/useTerminalTabs';
import { buildLayoutId } from '@/app/utils/layoutId';
import { ActionPalette, SaveFileDialog } from '@/features/action-menu';
import type { ActionRegistryItem, ActionContext } from '@/features/action-menu/types/actionMenu';
import { setProjectAgents } from '@/features/agent/api/agentApi';
import { insertToSessionAgent } from '@/features/agent-chat/api/insertToSessionAgent';
import { openAgentChatTab } from '@/features/agent-chat/api/openChatTab';
import { useRemoteContext } from '@/features/connection';
import { EditorGroupLayout } from '@/features/editor';
import { useFileDrop } from '@/features/file';
import { openLibraryAt } from '@/features/library/store/libraryNavigation';
import { ProjectGuidePage } from '@/features/project';
import { useProjectActionsContext } from '@/features/project/ProjectContext';
import { useQuickOpenStore } from '@/features/quick-open/store/quickOpenStore';
import { useRecentFilesStore } from '@/features/quick-open/store/recentFilesStore';
import { insertToSessionTerminal } from '@/features/terminal';
import { KeyRound } from '@/shared/components/icons';
import { useEditorContext, useAppContext, useTerminalInsert } from '@/shared/contexts';
import { panelView } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import {
  activeWorkspaceSession,
  useActiveWorkspaceKey,
  useActiveCheckoutPath,
} from '@/shared/store/workspaceStore';
import type { AgentConfig } from '@/shared/types';
import { createUntitledFileTab } from '@/shared/utils/createUntitledFileTab';
import { tabSpaceKeyOf } from '@/shared/utils/tabIdentity';
import { Button } from '@/ui/Button';

import { WelcomeScreen } from './WelcomeScreen';
function ProjectView() {
  const { showToast } = useAppContext();
  const { onAddProject } = useProjectActionsContext();
  const { remoteAuthStore, activeRemoteCheckoutPath, setRemoteOpenSessions, setPendingAuthEntry } =
    useRemoteContext();
  const { agents, onAgentClick } = useEditorContext();
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeCheckoutPath = useActiveCheckoutPath();
  // Determine the current project ID (all types via unified store)
  const currentProjectId = activeProject?.id ?? null;
  const activeWorkspaceKey = useActiveWorkspaceKey(currentProjectId);
  // Composite tab key: worktree gets its own independent tab space
  const tabKey = currentProjectId
    ? (activeWorkspaceKey ?? tabSpaceKeyOf({ kind: 'app' }))
    : tabSpaceKeyOf({ kind: 'app' });
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
    activeRemoteCheckoutPath,
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
    if (!currentProjectId) return;
    openAgentChatTab(activeWorkspaceSession(currentProjectId));
  }, [currentProjectId]);

  const handleGuideNewFile = useCallback(() => {
    if (!tabKey || !currentProjectId) return;
    createUntitledFileTab(currentProjectId);
  }, [tabKey, currentProjectId]);

  const handleSelectAgent = useCallback(
    (agent: AgentConfig) => {
      const opened = handleAgentClick(agent);
      if (opened && currentProjectId) {
        setProjectAgents(currentProjectId, [agent.id]).catch((err) => {
          console.error('[ProjectView] Failed to set project agent:', err);
        });
      }
    },
    [handleAgentClick, currentProjectId],
  );

  const handleBuildLayoutId = useCallback(
    (groupId: string, tabId: string | null) => buildLayoutId(activeProject, groupId, tabId),
    [activeProject],
  );

  // tab → 槽位 / 回中心：编排只有一处（app/utils/tabSurface），这里只把 false 翻成提示。
  // 没有激活项目时 tabKey 是 App 空间键 —— 槽位宿主只投影 workspace 的 tab（I4），
  // 移到那里不会有渲染点，因此这种情况不提供入口（undefined = 菜单不出现在 dock 项）。
  const { move: handleMoveTabToSlot, canDock: canDockTab } = useMoveTabToSlot(
    currentProjectId ? tabKey : null,
  );
  const moveTabToSlotAction = currentProjectId ? handleMoveTabToSlot : undefined;

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
            createUntitledFileTab(currentProjectId);
          }
          break;
        }
        case 'open-side-terminal':
          useDockStore.getState().toggleView(panelView('projects'));
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
    [handleAddTerminalTab, activeProject, currentProjectId],
  );

  // ── Terminal / agent-input 插入能力注册 ─────────────────────────────────
  // 通过 TerminalInsertContext 向 dock 面板（LibraryPanel 等）暴露插入能力，
  // 替代此前的 window 全局函数桥接（__neekoInsertTo*）：显式类型契约 +
  // 挂载/卸载生命周期管理。
  const { register } = useTerminalInsert();

  /**
   * agent 目标投递（composer 优先 → 降级 Agent CLI 终端 → 显式 false，决议 Q1/Q5）
   * —— **两个派发点（dock 面板 Context / 命令面板）共用这一个实现**。
   * 返回真实成败，降级与提示归调用方（`useInsertPromptToWorkspace` 走 clipboard + toast）；
   * 旧实现派发「零监听者的 DOM 广播」，函数恒存在却什么都不做，连兜底都进不去。
   * 身份一律命令式现取 store（不读渲染闭包，见 hook-guidelines「Store 快照模式」），
   * 因此引用永久稳定，两个消费方拿到的是同一个函数。
   */
  const insertToAgentInput = useCallback((text: string): boolean => {
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject) return false;
    try {
      return insertToSessionAgent(activeWorkspaceSession(activeProject.id), text).ok;
    } catch (err) {
      console.error('[ProjectView] insertToAgentInput failed:', err);
      return false;
    }
  }, []);

  useEffect(() => {
    const unregister = register({
      insertToAgentInput,
      /** Write text to the active terminal's PTY (secondary insert target). */
      insertToTerminal: (text: string) => {
        const activeProject = useProjectStore.getState().activeProject;
        if (!activeProject) return false;
        try {
          const result = insertToSessionTerminal(activeWorkspaceSession(activeProject.id), text);
          if (result.ok && result.isFallback) {
            showToast(`已插入到 ${result.landedTabTitle ?? '终端'}`, 'info');
          }
          return result.ok;
        } catch (err) {
          console.error('[ProjectView] insertToTerminal failed:', err);
          return false;
        }
      },
    });
    return unregister;
  }, [register, showToast, insertToAgentInput]);

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
      insertToAgentInput,
      showToast,
      openLibrary: (opts) => {
        const kind = opts?.kind ?? 'skill';
        // 'action' predates the skill/prompt/mcp tabs — falls back to skills.
        // 纯导航：prompt 弹窗走 `PromptDialogHost`，不在这里劫持中心视图。
        openLibraryAt({ kind: kind === 'prompt' ? 'prompt' : 'skill' });
      },
    }),
    [currentProjectId, tabKey, agents, showToast, insertToAgentInput],
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
          onMoveTabToSlot={moveTabToSlotAction}
          canDockTab={canDockTab}
        />
      ) : hasActiveProject && activeProject ? (
        <ProjectGuidePage
          projectId={activeProject.id}
          projectName={activeProject.name}
          projectPath={activeProject.path}
          selectedAgentIds={activeProject.selected_agents ?? []}
          selectedAgent={selectedAgent}
          worktreePath={activeCheckoutPath}
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

export default React.memo(ProjectView);
