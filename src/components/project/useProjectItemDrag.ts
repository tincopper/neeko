import { useCallback, useState } from "react";

export function useProjectItemDrag(
  projectId: string,
  onDragEnd?: (draggedId: string, targetId: string) => void,
) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", projectId);
      e.dataTransfer.effectAllowed = "move";
      (e.target as HTMLElement).classList.add("dragging");
    },
    [projectId],
  );

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove("dragging");
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const draggedId = e.dataTransfer.getData("text/plain");
      if (draggedId && draggedId !== projectId && onDragEnd) {
        onDragEnd(draggedId, projectId);
      }
    },
    [projectId, onDragEnd],
  );

  return {
    isDragOver,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
