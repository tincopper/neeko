import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { Bug, X } from '@/shared/components/icons';
import { useProjectStore } from '@/shared/store/projectStore';
import { Island } from '@/ui/Island';

import { statusMeta } from '../statusMeta';
import { useDebugStore } from '../store/debugStore';
import type { DebugPanelTab } from '../types';

import DebugBreakpointsPane from './DebugBreakpointsPane';
import DebugConsolePane from './DebugConsolePane';
import DebugFramesColumn from './DebugFramesColumn';
import DebugToolbar, { type DebugToolbarAction } from './DebugToolbar';
import DebugVariablesPane from './DebugVariablesPane';

const VIEW_TABS: { id: DebugPanelTab; label: string }[] = [
  { id: 'session', label: 'Frames & Variables' },
  { id: 'console', label: 'Console' },
  { id: 'breakpoints', label: 'Breakpoints' },
];

const PANEL_H_KEY = 'neeko.debug.panelHeight';
const FRAMES_W_KEY = 'neeko.debug.framesWidth';
const PANEL_H_DEFAULT = 260;
const PANEL_H_MIN = 140;
const PANEL_H_MAX_RATIO = 0.7;
const FRAMES_W_DEFAULT = 280;
const FRAMES_W_MIN = 160;
const FRAMES_W_MAX = 560;

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

/**
 * Bottom debug panel shell — theme tokens, resizable height + frames column,
 * header with tabs. Pane bodies live in sibling `Debug*Pane/Column` files.
 * Layout/chrome aligned with RightPanel + GitCommitPanel.
 */
function DebugPanel() {
  const session = useDebugStore((s) => s.session);
  const panelOpen = useDebugStore((s) => s.panelOpen);
  const panelTab = useDebugStore((s) => s.panelTab);
  const setPanelOpen = useDebugStore((s) => s.setPanelOpen);
  const setPanelTab = useDebugStore((s) => s.setPanelTab);
  const control = useDebugStore((s) => s.control);
  const stop = useDebugStore((s) => s.stop);
  const listAllBreakpoints = useDebugStore((s) => s.listAllBreakpoints);
  const error = useDebugStore((s) => s.error);

  const latestPanelH = useRef(PANEL_H_DEFAULT);
  const latestFramesW = useRef(FRAMES_W_DEFAULT);

  const [panelHeight, setPanelHeight] = useState(() => readStored(PANEL_H_KEY, PANEL_H_DEFAULT));
  const [framesWidth, setFramesWidth] = useState(() => readStored(FRAMES_W_KEY, FRAMES_W_DEFAULT));

  useEffect(() => {
    latestPanelH.current = panelHeight;
  }, [panelHeight]);
  useEffect(() => {
    latestFramesW.current = framesWidth;
  }, [framesWidth]);

  // Header breakpoint badge — scoped to the active project (same as before).
  const activeProject = useProjectStore((s) => s.activeProject);
  const projectId = activeProject?.id ?? null;
  const breakpointsMap = useDebugStore((s) => (projectId ? s.breakpoints[projectId] : undefined));
  const bpCount = useMemo(
    () => (projectId ? listAllBreakpoints(projectId).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, breakpointsMap, listAllBreakpoints],
  );

  const live = !!session && session.status !== 'terminated' && session.status !== 'ended';
  const isStopped = live && session?.status === 'stopped';
  const isRunning = live && !isStopped;
  const meta = statusMeta(session?.status, !!error);

  // Panel vertical resize (drag top edge) — same interaction as GitCommitPanel divider
  const startPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = latestPanelH.current;
    const maxH = Math.floor(window.innerHeight * PANEL_H_MAX_RATIO);

    const onMove = (ev: MouseEvent) => {
      // Dragging up increases height
      const next = Math.min(maxH, Math.max(PANEL_H_MIN, startH + (startY - ev.clientY)));
      latestPanelH.current = next;
      setPanelHeight(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      writeStored(PANEL_H_KEY, latestPanelH.current);
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Frames column horizontal resize — same hit style as RightPanel / SplitLayout
  const startFramesResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = latestFramesW.current;

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(FRAMES_W_MAX, Math.max(FRAMES_W_MIN, startW + (ev.clientX - startX)));
      latestFramesW.current = next;
      setFramesWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      writeStored(FRAMES_W_KEY, latestFramesW.current);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

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
          <div className="inline-flex items-center gap-1.5 shrink-0 px-2.5 max-w-[220px]">
            <Bug size={13} className="text-text-secondary shrink-0" />
            <span className="text-[var(--font-size)] font-medium text-text-primary">Debug</span>
            {session?.configName ? (
              <span
                className="inline-flex items-center gap-1.5 min-w-0 max-w-[150px]"
                title={`${meta.label} · ${session.configName}`}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', meta.dot)} />
                <span className="truncate text-[calc(var(--font-size)-1px)] text-text-secondary">
                  {session.configName}
                </span>
              </span>
            ) : (
              <span className="text-[calc(var(--font-size)-1px)] text-text-muted">No session</span>
            )}
          </div>

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
