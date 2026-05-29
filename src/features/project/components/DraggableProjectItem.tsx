import React from "react";
import { cn } from '@/lib/utils';
import type { DragOffset, DropIndicator } from "./useProjectItemDrag";

interface DraggableProjectItemProps {
  /** Unique id for drag identification */
  dragId: string;
  /** Whether this item is currently being dragged */
  isDragging: boolean;
  /** Current drag offset for transform */
  dragOffset: DragOffset;
  /** Drop indicator state (null when not a drop target) */
  dropIndicator: DropIndicator | null;
  /** Whether this item is active */
  isActive?: boolean;
  /** Pointer event handlers */
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  /** Child content */
  children: React.ReactNode;
  /** Additional class name */
  className?: string;
}

const DraggableProjectItem: React.FC<DraggableProjectItemProps> = ({
  dragId,
  isDragging,
  dragOffset,
  dropIndicator,
  isActive = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  children,
  className,
}) => {
  // Determine if this item should show drop indicator
  const isDropTarget = dropIndicator?.targetId === dragId;
  const dropPosition = isDropTarget ? dropIndicator.position : null;

  return (
    <div
      data-drag-id={dragId}
      className={cn(
        "relative mb-0.5 rounded-md overflow-visible transition-[opacity,transform,box-shadow] duration-150",
        isActive && "active",
        isDragging && [
          "opacity-50 scale-[1.02] rotate-[0.5deg]",
          "shadow-lg shadow-black/20",
          "z-50",
        ],
        !isDragging && "cursor-grab",
        className,
      )}
      style={
        isDragging
          ? {
              transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
              position: "relative" as const,
              zIndex: 50,
            }
          : undefined
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Drop indicator - blue border with glow */}
      {dropPosition === "before" && (
        <div
          className="absolute -top-[3px] left-0 right-0 h-[2px] bg-accent-blue rounded-full z-[60]"
          style={{
            boxShadow: "0 0 8px 2px rgba(59, 130, 246, 0.5)",
          }}
        />
      )}

      {children}

      {dropPosition === "after" && (
        <div
          className="absolute -bottom-[3px] left-0 right-0 h-[2px] bg-accent-blue rounded-full z-[60]"
          style={{
            boxShadow: "0 0 8px 2px rgba(59, 130, 246, 0.5)",
          }}
        />
      )}
    </div>
  );
};

export default React.memo(DraggableProjectItem);
