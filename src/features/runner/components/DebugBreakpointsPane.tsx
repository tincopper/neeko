import React, { useCallback, useMemo } from 'react';

import { CircleDot, Eye, EyeOff, X } from '@/shared/components/icons';
import { useProjectStore } from '@/shared/store/projectStore';

import { openSourceAtLine } from '../navigate';
import { isBreakpointEffective, useDebugStore } from '../store/debugStore';

import { EmptyHint } from './PanePrimitives';

/** Saved breakpoints list — persists to `.neeko/breakpoints.json`. */
function DebugBreakpointsPane() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const projectId = activeProject?.id ?? null;
  const listAllBreakpoints = useDebugStore((s) => s.listAllBreakpoints);
  const removeBreakpoint = useDebugStore((s) => s.removeBreakpoint);
  const setBreakpointEnabled = useDebugStore((s) => s.setBreakpointEnabled);
  const muted = useDebugStore((s) => (projectId ? !!s.breakpointsMuted[projectId] : false));

  const breakpointsMap = useDebugStore((s) => (projectId ? s.breakpoints[projectId] : undefined));
  const breakpoints = useMemo(
    () => (projectId ? listAllBreakpoints(projectId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, breakpointsMap, listAllBreakpoints],
  );

  // 点断点是**用户意图**（不改变调试状态）：走一次性跳转目标，而不是停点跟随派生链。
  const handleBpClick = useCallback(async (filePath: string, line: number) => {
    // 项目 id + 路径是「打开源码」的最小输入；缺一不可（本项目内不需要额外回落）。
    const project = useProjectStore.getState().activeProject;
    if (!project?.id || !project.path) return;
    await openSourceAtLine(project.id, project.path, filePath, line, 1);
  }, []);

  // 切换单个使能位：mute 下照常改位（视觉在 unmute 后体现，评审 P12/D8）。
  const handleToggleEnabled = useCallback(
    (filePath: string, line: number, enabled: boolean) => {
      if (!projectId) return;
      void setBreakpointEnabled(projectId, filePath, line, !enabled);
    },
    [projectId, setBreakpointEnabled],
  );

  return (
    <div className="flex-1 overflow-y-auto text-[var(--font-size)] bg-bg-secondary">
      {breakpoints.length === 0 ? (
        <EmptyHint>
          No breakpoints. Click a line number or the left gutter to set one.
          <span className="block mt-1 text-text-muted">
            Saved to <code className="text-text-secondary">.neeko/breakpoints.json</code>
          </span>
        </EmptyHint>
      ) : (
        breakpoints.map((bp) => {
          const effective = isBreakpointEffective(bp.enabled, muted);
          return (
            <div
              key={`${bp.filePath}:${bp.line}`}
              className={[
                'flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover group border-b border-border/60',
                effective ? '' : 'opacity-50',
              ].join(' ')}
            >
              <CircleDot
                size={12}
                className={`${effective ? 'text-accent-red' : 'text-text-muted'} shrink-0`}
              />
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
                aria-pressed={effective}
                title={effective ? 'Disable breakpoint' : 'Enable breakpoint'}
                className="inline-flex items-center justify-center h-5 w-5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer shrink-0 transition-colors"
                onClick={() => handleToggleEnabled(bp.filePath, bp.line, bp.enabled)}
              >
                {effective ? <Eye size={12} /> : <EyeOff size={12} />}
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
          );
        })
      )}
    </div>
  );
}

export default React.memo(DebugBreakpointsPane);
