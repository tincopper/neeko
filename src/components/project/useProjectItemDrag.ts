import { useCallback, useRef, useState } from "react";

/** Minimum pointer movement (px) before drag activates */
const DRAG_THRESHOLD = 5;

export interface DragOffset {
  x: number;
  y: number;
}

export interface DropIndicator {
  /** The id of the item being hovered over */
  targetId: string;
  /** "before" or "after" the target item */
  position: "before" | "after";
}

export interface UseProjectItemDragOptions {
  projectId: string;
  /**
   * Layout axis. "y" (default) — vertical list, midY decides before/after.
   * "x" — horizontal strip (e.g. tab bar), midX decides before/after.
   */
  axis?: "x" | "y";
  /**
   * Optional CSS selector that scopes which `[data-drag-id]` elements are
   * considered drop targets. Useful when multiple drag groups coexist (tab
   * bar + project list) on the same page. If omitted, ALL `[data-drag-id]`
   * are eligible, matching legacy behaviour.
   */
  scopeSelector?: string;
  /**
   * Called on successful drop. Position is forwarded so consumers that care
   * about insertion direction (tab reorder) can use it; legacy callers that
   * only need (draggedId, targetId) can ignore the third argument.
   */
  onDragEnd?: (
    draggedId: string,
    targetId: string,
    position: "before" | "after",
  ) => void;
}

export function useProjectItemDrag({
  projectId,
  axis = "y",
  scopeSelector,
  onDragEnd,
}: UseProjectItemDragOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<DragOffset>({ x: 0, y: 0 });
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  // Mutable refs for tracking pointer state without re-renders
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef(false);
  /** Ref mirror of dropIndicator to avoid stale closure in handlePointerUp */
  const dropIndicatorRef = useRef<DropIndicator | null>(null);

  /** Check if the event target has [data-no-drag] attribute */
  const isNoDragTarget = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    return !!target.closest("[data-no-drag]");
  }, []);

  /**
   * Find the drop target based on pointer position.
   * Uses document.elementsFromPoint to find the nearest project item
   * and determines before/after position based on element center (X for
   * horizontal axis, Y for vertical).
   */
  const findDropTarget = useCallback(
    (clientX: number, clientY: number): DropIndicator | null => {
      // Temporarily hide the dragged element so elementsFromPoint can see behind it
      const draggedEl = document.querySelector(`[data-drag-id="${projectId}"]`) as HTMLElement | null;
      if (draggedEl) draggedEl.style.pointerEvents = "none";

      const elements = document.elementsFromPoint(clientX, clientY);

      if (draggedEl) draggedEl.style.pointerEvents = "";

      for (const el of elements) {
        const itemEl = el.closest("[data-drag-id]") as HTMLElement | null;
        if (!itemEl) continue;
        // Scope: skip drop targets outside the configured scope (mixes tab bar + project list)
        if (scopeSelector && !itemEl.closest(scopeSelector)) continue;
        // data-drag-disabled: opt-out target (e.g. pinned tab)
        if (itemEl.dataset.dragDisabled !== undefined) continue;
        const targetId = itemEl.dataset.dragId;
        if (!targetId || targetId === projectId) continue;

        const rect = itemEl.getBoundingClientRect();
        let position: "before" | "after";
        if (axis === "x") {
          const midX = rect.left + rect.width / 2;
          position = clientX < midX ? "before" : "after";
        } else {
          const midY = rect.top + rect.height / 2;
          position = clientY < midY ? "before" : "after";
        }

        return { targetId, position };
      }
      return null;
    },
    [projectId, axis, scopeSelector],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isNoDragTarget(e)) return;
      // Only respond to primary button (left click)
      if (e.button !== 0) return;

      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      activeRef.current = false;

      // Capture pointer to track movement outside the element
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [isNoDragTarget],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointerStartRef.current) return;

      const dx = e.clientX - pointerStartRef.current.x;
      const dy = e.clientY - pointerStartRef.current.y;

      // Check threshold before activating drag
      if (!activeRef.current) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        activeRef.current = true;
        setIsDragging(true);
        // Disable text selection during drag
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }

      // Update offset for transform: translate()
      setDragOffset({ x: dx, y: dy });

      // Find and update drop target (sync ref for handlePointerUp)
      const target = findDropTarget(e.clientX, e.clientY);
      dropIndicatorRef.current = target;
      setDropIndicator(target);
    },
    [projectId, findDropTarget],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (activeRef.current) {
        // Commit the drag if there's a valid drop target
        // Read from ref to avoid stale closure over dropIndicator state
        const currentDrop = dropIndicatorRef.current;
        if (currentDrop && onDragEnd) {
          onDragEnd(projectId, currentDrop.targetId, currentDrop.position);
        }

        // Reset drag state
        setIsDragging(false);
        setDragOffset({ x: 0, y: 0 });
        setDropIndicator(null);
        dropIndicatorRef.current = null;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }

      pointerStartRef.current = null;
      activeRef.current = false;

      // Release pointer capture
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture may already be released
      }
    },
    [projectId, onDragEnd],
  );

  const handlePointerCancel = useCallback(() => {
    // Cancel drag on pointer cancel (e.g., element removed from DOM)
    pointerStartRef.current = null;
    activeRef.current = false;
    dropIndicatorRef.current = null;
    setIsDragging(false);
    setDragOffset({ x: 0, y: 0 });
    setDropIndicator(null);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  return {
    isDragging,
    dragOffset,
    dropIndicator,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  };
}
