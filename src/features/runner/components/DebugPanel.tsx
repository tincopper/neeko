import React, { useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import { X } from '@/shared/components/icons';
import { useProjectStore } from '@/shared/store/projectStore';
import { Island } from '@/ui/Island';

import { useDragResize } from '../hooks/useDragResize';
import { statusMeta } from '../statusMeta';
import { useDebugStore } from '../store/debugStore';
import { useJavaDebugStore } from '../store/javaDebugStore';
import type { DebugPanelTab } from '../types';

import DebugBreakpointsPane from './DebugBreakpointsPane';
import DebugConsolePane from './DebugConsolePane';
import DebugFramesColumn from './DebugFramesColumn';
import DebugSessionBadge from './DebugSessionBadge';
import DebugToolbar, { type DebugToolbarAction } from './DebugToolbar';
import DebugVariablesPane from './DebugVariablesPane';

const VIEW_TABS: { id: DebugPanelTab; label: string }[] = [
  { id: 'session', label: 'Frames & Variables' },
  { id: 'console', label: 'Console' },
  { id: 'breakpoints', label: 'Breakpoints' },
];

/**
 * Bottom debug panel shell — theme tokens, resizable height + frames column,
 * header with tabs. Pane bodies live in sibling `Debug*Pane/Column` files.
 * Layout/chrome aligned with RightPanel + GitCommitPanel.
 */
function DebugPanel() {
  const session = useDebugStore((s) => s.session);
  const javaBackendLabel = useJavaDebugStore((s) => s.backendLabel);
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const panelOpen = useDebugStore((s) => s.panelOpen);
  /** 「重试 JDTLS」：清除本会话的降级记忆并提示再点 Debug（不自动重启会话）。 */
  const handleRetryJdtls = useCallback(() => {
    if (!activeProjectId) return;
    useJavaDebugStore.getState().clearHostFallback(activeProjectId);
    useJavaDebugStore.getState().setBackendLabel(null);
    useDebugStore
      .getState()
      .pushConsole('sys', 'JDTLS backend re-enabled for this project — click Debug to retry.');
  }, [activeProjectId]);
  const panelTab = useDebugStore((s) => s.panelTab);
  const setPanelOpen = useDebugStore((s) => s.setPanelOpen);
  const setPanelTab = useDebugStore((s) => s.setPanelTab);
  const control = useDebugStore((s) => s.control);
  const stop = useDebugStore((s) => s.stop);

  const listAllBreakpoints = useDebugStore((s) => s.listAllBreakpoints);
  const error = useDebugStore((s) => s.error);
  const activeProject = useProjectStore((s) => s.activeProject);
  const projectId = activeProject?.id ?? null;
  const breakpointsMap = useDebugStore((s) => (projectId ? s.breakpoints[projectId] : undefined));
  const bpCount = useMemo(
    () => (projectId ? listAllBreakpoints(projectId).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, breakpointsMap, listAllBreakpoints],
  );

  // 面板高度 / 侧栏宽度：同一套拖拽 + 持久化（实现见 hooks/useDragResize）。
  const { size: panelHeight, startResize: startPanelResize } = useDragResize({
    storageKey: 'neeko.debug.panelHeight',
    defaultSize: 260,
    min: 140,
    max: () => Math.floor(window.innerHeight * 0.7),
    axis: 'vertical',
    cursor: 'row-resize',
  });
  const { size: framesWidth, startResize: startFramesResize } = useDragResize({
    storageKey: 'neeko.debug.framesWidth',
    defaultSize: 280,
    min: 160,
    max: 560,
    axis: 'horizontal',
    cursor: 'col-resize',
  });

  const live = !!session && session.status !== 'terminated' && session.status !== 'ended';
  const isStopped = live && session?.status === 'stopped';
  const isRunning = live && !isStopped;
  const meta = statusMeta(session?.status, !!error);

  const handleToolbar = useCallback(
    (action: DebugToolbarAction) => {
      if (action === 'stop') {
        void stop();
        return;
      }
      void control(action);
    },
    [control, stop],
  );

  if (!panelOpen) return null;

  // Island shell (ui/Island): surface + gutters shared with DockZone / center editor.
  return (
    <div className="shrink-0 mx-11 px-px pb-0.5">
      <Island className="relative" style={{ height: panelHeight }}>
        {/* Top edge resize handle — full-width strip like SplitLayout */}
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div
          role="separator"
          tabIndex={0}
          className="absolute top-0 left-0 right-0 h-3 z-20 cursor-row-resize group"
          onMouseDown={startPanelResize}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
            }
          }}
          title="Drag to resize debug panel"
          aria-orientation="horizontal"
          aria-label="Resize debug panel"
        >
          <div className="absolute left-0 right-0 top-0 h-1 bg-transparent group-hover:bg-accent-blue/50 group-active:bg-accent-blue/60 transition-colors rounded-t-lg" />
          <div className="absolute left-1/2 top-1 -translate-x-1/2 w-8 h-[3px] rounded-full bg-border/80 group-hover:bg-accent-blue/70 group-active:bg-accent-blue transition-colors" />
        </div>
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}

        {/* Header — island tab bar density */}
        <div className="flex items-center border-b border-border shrink-0 bg-bg-secondary h-8 rounded-t-lg">
          <DebugSessionBadge
            statusLabel={meta.label}
            statusDot={meta.dot}
            configName={session?.configName ?? null}
            javaBackendLabel={javaBackendLabel}
            onRetryJdtls={handleRetryJdtls}
          />

          <div className="w-px h-3.5 bg-border shrink-0" />

          <div className="px-1 shrink-0">
            <DebugToolbar
              size="sm"
              variant="flat"
              isStopped={isStopped}
              isRunning={isRunning}
              showStop
              onAction={handleToolbar}
            />
          </div>
          <div className="flex-1 min-w-0" />

          {/* Tabs — underline active style (RightPanel) */}
          <div className="inline-flex items-stretch h-full shrink-0">
            {VIEW_TABS.map((t) => {
              const active = panelTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPanelTab(t.id)}
                  className={cn(
                    'px-3 text-xs transition-colors duration-100 cursor-pointer border-b-2 h-full',
                    active
                      ? 'border-accent-blue text-text-primary'
                      : 'border-transparent text-text-secondary hover:text-text-primary',
                  )}
                >
                  {t.label}
                  {t.id === 'breakpoints' && bpCount > 0 ? (
                    <span className="ml-1 text-accent-red tabular-nums">{bpCount}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="ml-0.5 mr-1 inline-flex items-center justify-center h-6 w-6 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer transition-colors shrink-0"
            title="Hide panel"
            onClick={() => setPanelOpen(false)}
          >
            <X size={13} />
          </button>
        </div>

        {error ? (
          <div className="shrink-0 px-3 py-1 text-[calc(var(--font-size)-1px)] text-accent-red bg-accent-red/8 border-b border-border truncate">
            {error}
          </div>
        ) : null}

        {/* Body */}
        {panelTab === 'session' && (
          <div className="flex-1 flex min-h-0">
            <DebugFramesColumn width={framesWidth} onResizeStart={startFramesResize} />
            <DebugVariablesPane />
          </div>
        )}

        {panelTab === 'console' && <DebugConsolePane />}

        {panelTab === 'breakpoints' && <DebugBreakpointsPane />}
      </Island>
    </div>
  );
}

export default React.memo(DebugPanel);
