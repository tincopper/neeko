import { useState, useRef, useCallback } from 'react';

import { useDockStore } from '@/shared/store/dockStore';

/**
 * Hook: drag-to-re-dock handlers for DockZone components.
 *
 * Manages drag-over highlighting state and HTML5 Drag API event handlers.
 *
 * NOTE: Uses HTML5 Drag API. If this conflicts with Tauri WebView's
 * window-drag handling (as documented in .trellis/spec/frontend/interaction-patterns.md §10),
 * migrate to Pointer Events approach (see useProjectItemDrag pattern).
 * TODO: Test in `pnpm tauri dev` and verify no window-drag interference.
 */
export function useDragToReDock(zoneId: string) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragOverCounter = useRef(0);
  const movePanel = useDockStore((s) => s.movePanel);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/neeko-panel-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/neeko-panel-id')) {
      e.preventDefault();
      dragOverCounter.current += 1;
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/neeko-panel-id')) {
      dragOverCounter.current -= 1;
      if (dragOverCounter.current <= 0) {
        dragOverCounter.current = 0;
        setIsDragOver(false);
      }
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      dragOverCounter.current = 0;
      const panelId = e.dataTransfer.getData('application/neeko-panel-id');
      if (panelId) {
        movePanel(panelId, zoneId);
      }
    },
    [movePanel, zoneId],
  );

  const dragHandlers = {
    onDragOver: handleDragOver,
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

  return { isDragOver, dragHandlers };
}
