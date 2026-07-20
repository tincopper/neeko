import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bug, CircleDot, X } from '@/shared/components/icons';
import { cn } from '@/shared/utils/cn';
import { buildFontFamily } from '@/shared/utils/terminal';

import { useAppContext } from '@/shared/contexts/AppContext';
import { useProjectStore } from '@/features/project/store';

import { useDebugStore } from '../store/debugStore';
import { openSourceAtLine, activeProjectPaths } from '../navigate';
import type { DebugPanelTab, StackFrameDto } from '../types';
import DebugToolbar, { type DebugToolbarAction } from './DebugToolbar';

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

function statusMeta(status: string | undefined, hasError: boolean) {
  if (status === 'stopped') {
    return { label: 'Paused', dot: 'bg-accent-yellow' };
  }
  if (status === 'running' || status === 'starting') {
    return {
      label: status === 'starting' ? 'Starting' : 'Running',
      dot: 'bg-accent-green animate-pulse',
    };
  }
  if (status === 'terminated' || status === 'ended' || hasError) {
    return {
      label: hasError && status !== 'terminated' ? 'Failed' : 'Ended',
      dot: 'bg-text-muted',
    };
  }
  return { label: 'Idle', dot: 'bg-text-muted/60' };
}

/**
 * Bottom debug panel — theme tokens, resizable height + frames column.
 * Layout/chrome aligned with RightPanel + GitCommitPanel.
 */
function DebugPanel() {
  const session = useDebugStore((s) => s.session);
  const frames = useDebugStore((s) => s.frames);
  const variables = useDebugStore((s) => s.variables);
  const consoleLines = useDebugStore((s) => s.consoleLines);
  const selectedFrameId = useDebugStore((s) => s.selectedFrameId);
  const panelOpen = useDebugStore((s) => s.panelOpen);
  const panelTab = useDebugStore((s) => s.panelTab);
  const setPanelOpen = useDebugStore((s) => s.setPanelOpen);
  const setPanelTab = useDebugStore((s) => s.setPanelTab);
  const selectFrame = useDebugStore((s) => s.selectFrame);
  const evaluate = useDebugStore((s) => s.evaluate);
  const control = useDebugStore((s) => s.control);
  const stop = useDebugStore((s) => s.stop);
  const removeBreakpoint = useDebugStore((s) => s.removeBreakpoint);
  const listAllBreakpoints = useDebugStore((s) => s.listAllBreakpoints);
  const error = useDebugStore((s) => s.error);

  const activeProject = useProjectStore((s) => s.activeProject);
  const projectId = activeProject?.id ?? null;
  const { config } = useAppContext();

  /** Same typeface + size as Task Console / xterm. */
  const terminalType = useMemo(
    () => ({
      fontSize: config.terminalFontSize ?? 14,
      fontFamily: buildFontFamily(config.fontFamily ?? ''),
    }),
    [config.terminalFontSize, config.fontFamily],
  );

  const [expr, setExpr] = useState('');
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const latestPanelH = useRef(PANEL_H_DEFAULT);
  const latestFramesW = useRef(FRAMES_W_DEFAULT);

  const [panelHeight, setPanelHeight] = useState(() =>
    readStored(PANEL_H_KEY, PANEL_H_DEFAULT),
  );
  const [framesWidth, setFramesWidth] = useState(() =>
    readStored(FRAMES_W_KEY, FRAMES_W_DEFAULT),
  );

  latestPanelH.current = panelHeight;
  latestFramesW.current = framesWidth;

  const breakpointsMap = useDebugStore((s) =>
    projectId ? s.breakpoints[projectId] : undefined,
  );
  const breakpoints = useMemo(
    () => (projectId ? listAllBreakpoints(projectId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, breakpointsMap, listAllBreakpoints],
  );

  const live =
    !!session &&
    session.status !== 'terminated' &&
    session.status !== 'ended';
  const isStopped = live && session?.status === 'stopped';
  const isRunning = live && !isStopped;
  const meta = statusMeta(session?.status, !!error);

  useEffect(() => {
    if (panelTab !== 'console') return;
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLines, panelTab]);

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
      const next = Math.min(
        FRAMES_W_MAX,
        Math.max(FRAMES_W_MIN, startW + (ev.clientX - startX)),
      );
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

  const handleFrameClick = useCallback(
    async (frame: StackFrameDto) => {
      await selectFrame(frame.id);
      const paths = activeProjectPaths();
      if (paths && frame.sourcePath) {
        await openSourceAtLine(
          paths.projectId,
          paths.projectPath,
          frame.sourcePath,
          frame.line,
          frame.column,
        );
      }
    },
    [selectFrame],
  );

  const handleEval = useCallback(async () => {
    const text = expr.trim();
    if (!text) return;
    setExpr('');
    await evaluate(text);
  }, [expr, evaluate]);

  const handleBpClick = useCallback(async (filePath: string, line: number) => {
    const paths = activeProjectPaths();
    if (!paths) return;
    await openSourceAtLine(paths.projectId, paths.projectPath, filePath, line, 1);
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

  const bpCount = breakpoints.length;

  // Island shell: align with DockLayout toolbars (w-11) + zone gutters (px-px pb-0.5).
  // Surface: rounded-lg shadow-sm bg-bg-secondary — same as DockZone / center editor.
  return (
    <div className="shrink-0 mx-11 px-px pb-0.5">
      <div
        className="relative flex flex-col overflow-hidden rounded-lg shadow-sm bg-bg-secondary"
        style={{ height: panelHeight }}
      >
      {/* Top edge resize handle — full-width strip like SplitLayout */}
      <div
        className="absolute top-0 left-0 right-0 h-3 z-20 cursor-row-resize group"
        onMouseDown={startPanelResize}
        title="Drag to resize debug panel"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize debug panel"
      >
        <div className="absolute left-0 right-0 top-0 h-1 bg-transparent group-hover:bg-accent-blue/50 group-active:bg-accent-blue/60 transition-colors rounded-t-lg" />
        <div className="absolute left-1/2 top-1 -translate-x-1/2 w-8 h-[3px] rounded-full bg-border/80 group-hover:bg-accent-blue/70 group-active:bg-accent-blue transition-colors" />
      </div>

      {/* Header — island tab bar density */}
      <div className="flex items-center border-b border-border shrink-0 bg-bg-secondary h-8 rounded-t-lg">
        <div className="inline-flex items-center gap-1.5 shrink-0 px-2.5 max-w-[220px]">
          <Bug size={13} className="text-text-secondary shrink-0" />
          <span className="text-[var(--font-size)] font-medium text-text-primary">
            Debug
          </span>
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
            <span className="text-[calc(var(--font-size)-1px)] text-text-muted">
              No session
            </span>
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
          {/* Frames column */}
          <div
            className="relative flex flex-col min-h-0 border-r border-border bg-bg-secondary shrink-0"
            style={{ width: framesWidth }}
          >
            <SectionLabel>
              Frames
              {frames.length > 0 ? (
                <span className="ml-auto tabular-nums">{frames.length}</span>
              ) : null}
            </SectionLabel>
            <div className="flex-1 overflow-y-auto">
              {frames.length === 0 ? (
                <EmptyHint>
                  {live ? 'No stack frames' : 'Start debugging to inspect frames'}
                </EmptyHint>
              ) : (
                frames.map((f) => {
                  const selected = selectedFrameId === f.id;
                  const file = f.sourcePath
                    ? f.sourcePath.split(/[/\\]/).pop()
                    : null;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className={cn(
                        'w-full text-left px-2.5 py-1 cursor-pointer transition-colors duration-100',
                        selected
                          ? 'bg-accent-blue/10 text-text-primary'
                          : 'text-text-secondary hover:bg-bg-hover',
                      )}
                      title={f.sourcePath ?? f.name}
                      onClick={() => void handleFrameClick(f)}
                    >
                      <div
                        className={cn(
                          'truncate text-[var(--font-size)]',
                          selected && 'font-medium',
                        )}
                      >
                        {f.name}
                      </div>
                      <div className="truncate text-[10px] text-text-muted mt-0.5">
                        {file ? (
                          <>
                            {file}
                            <span className="text-text-muted">:{f.line}</span>
                          </>
                        ) : (
                          `line ${f.line}`
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Frames width resize handle — RightPanel style */}
            <div
              className="absolute top-0 right-0 bottom-0 w-3 translate-x-1/2 z-10 cursor-col-resize group"
              onMouseDown={startFramesResize}
              title="Drag to resize frames"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize frames column"
            >
              <div className="absolute left-1/2 top-0 bottom-0 w-1 -translate-x-1/2 bg-transparent group-hover:bg-accent-blue/50 group-active:bg-accent-blue/60 transition-colors" />
            </div>
          </div>

          {/* Variables + evaluate (evaluate lives here, not in Console) */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-bg-secondary">
            <div className="shrink-0 h-7 border-b border-border flex items-center px-2.5 gap-2 bg-bg-primary/40">
              <span className="text-accent-blue font-mono text-[var(--font-size)] shrink-0 select-none">
                ›
              </span>
              <input
                type="text"
                value={expr}
                onChange={(e) => setExpr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleEval();
                }}
                placeholder={
                  isStopped ? 'Evaluate expression…' : 'Evaluate when paused'
                }
                disabled={!isStopped}
                className="flex-1 min-w-0 bg-transparent text-[var(--font-size)] text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-40 font-mono"
              />
            </div>

            <SectionLabel>
              Variables
              {variables.length > 0 ? (
                <span className="ml-auto tabular-nums">{variables.length}</span>
              ) : null}
            </SectionLabel>

            <div className="flex-1 overflow-y-auto text-[var(--font-size)] font-mono">
              {variables.length === 0 ? (
                <EmptyHint className="font-sans">
                  {isStopped
                    ? 'Variables are not available'
                    : 'Pause to inspect variables'}
                </EmptyHint>
              ) : (
                variables.map((v, i) => (
                  <div
                    key={`${v.name}-${i}`}
                    className="px-2.5 py-0.5 hover:bg-bg-hover flex gap-2 items-baseline min-h-[22px]"
                    title={v.type ?? undefined}
                  >
                    <span className="text-accent-blue shrink-0">{v.name}</span>
                    <span className="text-text-muted shrink-0">=</span>
                    <span className="text-text-primary truncate">{v.value}</span>
                    {v.type ? (
                      <span className="text-[10px] text-text-muted shrink-0 ml-auto pl-2">
                        {v.type}
                      </span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {panelTab === 'console' && (
        <div
          className="flex-1 flex flex-col min-h-0 min-w-0"
          style={{ backgroundColor: 'var(--terminal-bg, var(--bg-secondary))' }}
        >
          {/* Match Task Console: same bg / fg / size / typeface as xterm */}
          <div
            className="flex-1 overflow-y-auto px-3 py-1.5 space-y-0.5"
            style={{
              fontSize: `${terminalType.fontSize}px`,
              fontFamily: terminalType.fontFamily,
              color: 'var(--terminal-fg, var(--text-secondary))',
              lineHeight: 1.35,
            }}
          >
            {consoleLines.length === 0 ? (
              <div
                className="h-full flex items-center justify-center px-3 text-center leading-relaxed"
                style={{
                  fontSize: `${terminalType.fontSize}px`,
                  fontFamily: terminalType.fontFamily,
                  color: 'var(--terminal-fg-dim, var(--text-muted))',
                }}
              >
                Debug output and build messages appear here.
              </div>
            ) : (
              consoleLines.map((line) => (
                <div
                  key={line.id}
                  className="whitespace-pre-wrap"
                  style={{
                    fontSize: `${terminalType.fontSize}px`,
                    fontFamily: terminalType.fontFamily,
                    color:
                      line.kind === 'in'
                        ? 'var(--accent-blue)'
                        : line.kind === 'err'
                          ? 'var(--accent-red)'
                          : line.kind === 'sys'
                            ? 'var(--terminal-fg-dim, var(--text-muted))'
                            : 'var(--terminal-fg, var(--text-secondary))',
                  }}
                >
                  {line.kind === 'in' ? `› ${line.text}` : line.text}
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>
        </div>
      )}

      {panelTab === 'breakpoints' && (
        <div className="flex-1 overflow-y-auto text-[var(--font-size)] bg-bg-secondary">
          {breakpoints.length === 0 ? (
            <EmptyHint>
              No breakpoints. Click a line number or the left gutter to set one.
              <span className="block mt-1 text-text-muted">
                Saved to{' '}
                <code className="text-text-secondary">.neeko/breakpoints.json</code>
              </span>
            </EmptyHint>
          ) : (
            breakpoints.map((bp) => (
              <div
                key={`${bp.filePath}:${bp.line}`}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover group border-b border-border/60"
              >
                <CircleDot size={12} className="text-accent-red shrink-0" />
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left cursor-pointer"
                  onClick={() => void handleBpClick(bp.filePath, bp.line)}
                  title={bp.filePath}
                >
                  <span className="text-text-primary truncate block">
                    {bp.filePath.split(/[/\\]/).pop()}
                    <span className="text-text-muted">:{bp.line}</span>
                  </span>
                  <span className="text-[10px] text-text-muted truncate block mt-0.5">
                    {bp.filePath}
                  </span>
                </button>
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center h-5 w-5 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover cursor-pointer shrink-0 transition-opacity"
                  title="Remove breakpoint"
                  onClick={() => {
                    if (projectId) void removeBreakpoint(projectId, bp.filePath, bp.line);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 h-6 flex items-center shrink-0 border-b border-border text-[10px] font-medium uppercase tracking-wide text-text-muted">
      {children}
    </div>
  );
}

function EmptyHint({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'px-3 py-3 text-[calc(var(--font-size)-1px)] text-text-muted leading-relaxed',
        className,
      )}
    >
      {children}
    </div>
  );
}

export default React.memo(DebugPanel);
