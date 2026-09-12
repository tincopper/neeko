import React, { useCallback, useMemo } from 'react';

import { CircleDot, X } from '@/shared/components/icons';
import { useProjectStore } from '@/shared/store/projectStore';

import { activeProjectPaths } from '../navigate';
import { openStopSource } from '../openStopSource';
import { useDebugStore } from '../store/debugStore';

import { EmptyHint } from './PanePrimitives';

/** Saved breakpoints list — persists to `.neeko/breakpoints.json`. */
function DebugBreakpointsPane() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const projectId = activeProject?.id ?? null;
  const listAllBreakpoints = useDebugStore((s) => s.listAllBreakpoints);
  const removeBreakpoint = useDebugStore((s) => s.removeBreakpoint);

  const breakpointsMap = useDebugStore((s) => (projectId ? s.breakpoints[projectId] : undefined));
  const breakpoints = useMemo(
    () => (projectId ? listAllBreakpoints(projectId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, breakpointsMap, listAllBreakpoints],
  );

  const handleBpClick = useCallback(async (filePath: string, line: number) => {
    const paths = activeProjectPaths();
    if (!paths) return;
    await openStopSource(paths.projectId, paths.projectPath, filePath, line, 1);
  }, []);

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
  );
}

export default React.memo(DebugBreakpointsPane);
