import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';

import { activeProjectPaths } from '../navigate';
import { openStopSource, openStopVirtualSource } from '../openStopSource';
import { useDebugStore } from '../store/debugStore';
import type { StackFrameDto } from '../types';

import { EmptyHint, SectionLabel } from './PanePrimitives';

interface DebugFramesColumnProps {
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
}

/** Call stack column — subscribes to frames/selection itself. */
function DebugFramesColumn({ width, onResizeStart }: DebugFramesColumnProps) {
  const frames = useDebugStore((s) => s.frames);
  const selectedFrameId = useDebugStore((s) => s.selectedFrameId);
  const selectFrame = useDebugStore((s) => s.selectFrame);
  const session = useDebugStore((s) => s.session);
  const live = !!session && session.status !== 'terminated' && session.status !== 'ended';

  const handleFrameClick = useCallback(
    async (frame: StackFrameDto) => {
      await selectFrame(frame.id);
      const paths = activeProjectPaths();
      if (!paths) return;
      if (frame.sourcePath) {
        await openStopSource(
          paths.projectId,
          paths.projectPath,
          frame.sourcePath,
          frame.line,
          frame.column,
        );
      } else if (frame.sourceReference) {
        await openStopVirtualSource(
          paths.projectId,
          frame.sourceName,
          frame.sourceReference,
          frame.line,
          frame.column,
        );
      }
    },
    [selectFrame],
  );

  return (
    <div
      className="relative flex flex-col min-h-0 border-r border-border bg-bg-secondary shrink-0"
      style={{ width }}
    >
      <SectionLabel>
        Frames
        {frames.length > 0 ? <span className="ml-auto tabular-nums">{frames.length}</span> : null}
      </SectionLabel>
      <div className="flex-1 overflow-y-auto">
        {frames.length === 0 ? (
          <EmptyHint>{live ? 'No stack frames' : 'Start debugging to inspect frames'}</EmptyHint>
        ) : (
          frames.map((f) => {
            const selected = selectedFrameId === f.id;
            const file = f.sourcePath ? f.sourcePath.split(/[/\\]/).pop() : null;
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
                <div className={cn('truncate text-[var(--font-size)]', selected && 'font-medium')}>
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
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        role="separator"
        tabIndex={0}
        className="absolute top-0 right-0 bottom-0 w-3 translate-x-1/2 z-10 cursor-col-resize group"
        onMouseDown={onResizeStart}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
          }
        }}
        title="Drag to resize frames"
        aria-orientation="vertical"
        aria-label="Resize frames column"
      >
        <div className="absolute left-1/2 top-0 bottom-0 w-1 -translate-x-1/2 bg-transparent group-hover:bg-accent-blue/50 group-active:bg-accent-blue/60 transition-colors" />
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    </div>
  );
}

export default React.memo(DebugFramesColumn);
