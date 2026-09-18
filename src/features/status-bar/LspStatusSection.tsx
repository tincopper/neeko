import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/shallow';

import { useLspStore, type LspSessionState } from '@/features/lsp/store/lspStore';
import { cn } from '@/lib/utils';
import { RefreshCw, ServerIcon, Square, TerminalIcon } from '@/shared/components/icons';
import { useProjectStore } from '@/shared/store/projectStore';

import { LspServerRow } from './LspServerRow';
import {
  EASE_IN,
  EASE_OUT,
  ENTER_DUR,
  EXIT_DUR,
  aggregateStatus,
  chipPresentation,
  formatInfoFooter,
  humanStatus,
  statusDotClass,
} from './lspStatusFormat';
import { ChevronDown } from './LspStatusIcons';
import { useLspServerActions } from './useLspServerActions';
import { useLspStatusMenus } from './useLspStatusMenus';

/**
 * Status-bar LSP chip + nested menus (main list + per-server submenu).
 * 标准 registry item：自订阅 store（PromptsStatusSection 范本），无 props。
 */
export function LspStatusSection() {
  const activeProjectPath = useProjectStore((s) => s.activeProject?.path);
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const projectName = useProjectStore((s) => s.activeProject?.name ?? 'Project');
  // Use shallow comparison to avoid re-render loops from new {} references.
  // Filter out stopped sessions — they should not appear in the status bar.
  const sessionEntries = useLspStore(
    useShallow((s) => {
      if (!activeProjectPath) return [] as LspSessionState[];
      const projectSessions = s.sessions[activeProjectPath];
      if (!projectSessions) return [] as LspSessionState[];
      return Object.values(projectSessions).filter((se) => se.status !== 'stopped');
    }),
  );
  // Open work-done-progress tokens for the active project (jdtls 长导入引用计数)。
  // token 非空即 busy：后端短任务 end 推的 session `ready` 已被 store 拦下，
  // 这里再兜底——status 已是 ready 但 token 未清空时仍按 indexing 展示。
  const projectTokens: Record<string, string[]> = useLspStore(
    useShallow((s) => s.progressTokens?.[activeProjectPath ?? ''] ?? {}),
  );

  const {
    dropdownOpen,
    setDropdownOpen,
    dropdownStyle,
    dropdownRef,
    buttonRef,
    rowRefs,
    activeSubmenuLanguageId,
    submenuStyle,
    submenuInfo,
    submenuInfoLoading,
    dropdownPresence,
    submenuPresence,
    submenuPositionReady,
    reducedMotion,
    closeAll,
    clearCloseTimer,
    openSubmenu,
    scheduleCloseSubmenu,
  } = useLspStatusMenus(activeProjectPath);

  const { handleRestart, handleStop, handleRestartAll, handleStopAll, handleViewLogs } =
    useLspServerActions({ activeProjectPath, activeProjectId, sessionEntries, closeAll });

  if (!activeProjectPath || sessionEntries.length === 0) return null;

  // open token 非空的会话视为 indexing（store 已拦 ready 覆盖，这里兜底展示层）。
  const displayEntries = sessionEntries.map((s) =>
    s.status === 'ready' && (projectTokens[s.languageId]?.length ?? 0) > 0
      ? { ...s, status: 'indexing' as const }
      : s,
  );
  const multi = displayEntries.length > 1;
  const agg = aggregateStatus(displayEntries);
  const activeSession = activeSubmenuLanguageId
    ? (displayEntries.find((s) => s.languageId === activeSubmenuLanguageId) ?? null)
    : null;

  // chip 展示决策（label / tooltip / 重试入口）下沉到纯函数模块，
  // 组件只负责渲染（见 lspStatusFormat.chipPresentation + 其单测）。
  const { label: chipLabel, title: chipHoverTitle, retry } = chipPresentation(displayEntries);

  return (
    <div className="relative flex items-center" ref={dropdownRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (dropdownOpen) closeAll();
          else setDropdownOpen(true);
        }}
        className="flex h-4 items-center gap-1.5 leading-4 hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue rounded-sm max-w-[240px]"
        title={chipHoverTitle}
        data-testid="lsp-status-chip"
      >
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-200',
            statusDotClass(agg),
          )}
        />
        {multi ? (
          <ServerIcon size={12} className="shrink-0" aria-hidden />
        ) : (
          <span className="truncate">{chipLabel}</span>
        )}
        <ChevronDown open={dropdownOpen} />
      </button>
      {retry && (
        <button
          type="button"
          onClick={() => void handleRestart(retry.languageId)}
          title={retry.label}
          aria-label={retry.label}
          className="ml-1.5 flex h-4 items-center rounded-sm px-0.5 text-status-failed hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
          data-testid="lsp-error-retry"
        >
          <RefreshCw size={12} className="shrink-0" aria-hidden />
        </button>
      )}

      {dropdownPresence.mounted &&
        dropdownStyle &&
        createPortal(
          <div
            className="bg-popover border border-border rounded-md shadow-lg py-1 z-50 text-xs text-text-primary"
            data-lsp-dropdown
            data-testid="lsp-status-dropdown"
            style={{
              ...dropdownStyle,
              opacity: dropdownPresence.show ? 1 : 0,
              transform: dropdownPresence.show
                ? 'translateY(0) scale(1)'
                : 'translateY(-4px) scale(0.96)',
              transition: reducedMotion
                ? 'opacity 80ms linear'
                : dropdownPresence.show
                  ? `opacity ${ENTER_DUR}ms ${EASE_OUT}, transform ${ENTER_DUR}ms ${EASE_OUT}`
                  : `opacity ${EXIT_DUR}ms ${EASE_IN}, transform ${EXIT_DUR}ms ${EASE_IN}`,
            }}
            onTransitionEnd={dropdownPresence.onTransitionEnd}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <div className="text-text-muted px-3 py-1 text-[11px] truncate" title={projectName}>
              {projectName || 'Project'}
            </div>
            <div className="border-t border-border my-0.5" />

            {displayEntries.map((session) => (
              <LspServerRow
                key={session.languageId}
                session={session}
                isActive={activeSubmenuLanguageId === session.languageId}
                onOpen={openSubmenu}
                registerRef={(el) => {
                  rowRefs.current[session.languageId] = el;
                }}
              />
            ))}

            <div className="border-t border-border my-0.5" />
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue flex items-center gap-2"
              onClick={() => void handleRestartAll()}
              data-testid="lsp-restart-all"
            >
              <RefreshCw size={12} className="shrink-0 text-text-muted" />
              Restart All Servers
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue flex items-center gap-2"
              onClick={() => void handleStopAll()}
              data-testid="lsp-stop-all"
            >
              <Square size={12} className="shrink-0 text-text-muted" />
              Stop All Servers
            </button>
          </div>,
          document.body,
        )}

      {submenuPresence.mounted &&
        activeSession &&
        submenuStyle &&
        createPortal(
          <div
            className="bg-popover border border-border rounded-md shadow-lg py-1 z-50 text-xs text-text-primary"
            data-lsp-submenu
            data-testid="lsp-server-submenu"
            style={{
              ...submenuStyle,
              opacity: submenuPresence.show ? 1 : 0,
              transform: submenuPresence.show
                ? 'translateX(0) scale(1)'
                : 'translateX(-4px) scale(0.96)',
              transition: reducedMotion
                ? 'opacity 80ms linear'
                : submenuPresence.show
                  ? `opacity ${ENTER_DUR}ms ${EASE_OUT}, transform ${ENTER_DUR}ms ${EASE_OUT}`
                  : `opacity ${EXIT_DUR}ms ${EASE_IN}, transform ${EXIT_DUR}ms ${EASE_IN}${
                      submenuPositionReady ? `, left 150ms ${EASE_OUT}, top 150ms ${EASE_OUT}` : ''
                    }`,
            }}
            onTransitionEnd={submenuPresence.onTransitionEnd}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue flex items-center gap-2"
              onClick={() => void handleViewLogs(activeSession)}
              data-testid="lsp-view-logs"
            >
              <TerminalIcon size={12} className="shrink-0 text-text-muted" />
              View Logs
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue flex items-center gap-2"
              onClick={() => void handleRestart(activeSession.languageId)}
              data-testid="lsp-restart-server"
            >
              <RefreshCw size={12} className="shrink-0 text-text-muted" />
              Restart Server
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue flex items-center gap-2"
              onClick={() => void handleStop(activeSession.languageId)}
              data-testid="lsp-stop-server"
            >
              <Square size={12} className="shrink-0 text-text-muted" />
              Stop Server
            </button>
            <div className="border-t border-border mt-0.5" />
            <div
              className="px-3 py-1.5 text-text-muted text-[11px] flex items-center gap-1.5"
              data-testid="lsp-server-info-footer"
              title={
                submenuInfoLoading
                  ? 'Loading…'
                  : formatInfoFooter(activeSession.status, submenuInfo)
              }
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-200',
                  statusDotClass(activeSession.status),
                )}
              />
              <span
                className="whitespace-nowrap transition-opacity duration-150"
                style={{ opacity: submenuInfoLoading ? 0.5 : 1 }}
              >
                {submenuInfoLoading
                  ? `${humanStatus(activeSession.status)} — …`
                  : formatInfoFooter(activeSession.status, submenuInfo)}
              </span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default LspStatusSection;
