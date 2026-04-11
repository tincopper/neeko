import { useState, useRef, useCallback } from "react";

export interface UseSideTerminalStateResult {
  // Derived state
  sideTerminalOpenSet: Set<string>;
  setSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  // Focus tracking
  focusedSideTerminalIndex: string | null;
  setFocusedSideTerminalIndex: (index: string | null) => void;
  // Ref for keyboard shortcuts
  sideTerminalOpenSetRef: React.MutableRefObject<Set<string>>;
  // Open handlers
  handleOpenSideTerminal: () => void;
  handleOpenWslSideTerminal: (_: string, projectId: string) => void;
  handleOpenRemoteSideTerminal: (_: string, projectId: string) => void;
}

export function useSideTerminalState(
  activeProjectId: string | null,
  activeProjectIdRef: React.MutableRefObject<string | null>,
  sideTerminalOpenMap: Record<string, Set<string>>,
  setSideTerminalOpenMap: React.Dispatch<React.SetStateAction<Record<string, Set<string>>>>,
  setWslSideTerminalOpen: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRemoteSideTerminalOpen: React.Dispatch<React.SetStateAction<Set<string>>>,
): UseSideTerminalStateResult {
  const emptySet = () => new Set<string>();

  const sideTerminalOpenSet = activeProjectId
    ? (sideTerminalOpenMap[activeProjectId] ?? emptySet())
    : emptySet();

  const setSideTerminalOpen = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setSideTerminalOpenMap(prev => ({
      ...prev,
      [pid]: updater(prev[pid] ?? emptySet()),
    }));
  }, [setSideTerminalOpenMap, activeProjectIdRef]);

  const [focusedSideTerminalIndex, setFocusedSideTerminalIndex] = useState<string | null>(null);

  const sideTerminalOpenSetRef = useRef<Set<string>>(new Set<string>());

  const handleOpenSideTerminal = useCallback(() => {
    setSideTerminalOpen(prev => {
      if (prev.size >= 4) return prev;
      let newIndex = 0;
      const next = new Set(prev);
      while (next.has(String(newIndex))) {
        newIndex++;
      }
      next.add(String(newIndex));
      return next;
    });
  }, [setSideTerminalOpen]);

  const handleOpenWslSideTerminal = useCallback((_: string, projectId: string) => {
    setWslSideTerminalOpen(prev => new Set(prev).add(projectId));
  }, [setWslSideTerminalOpen]);

  const handleOpenRemoteSideTerminal = useCallback((_: string, projectId: string) => {
    setRemoteSideTerminalOpen(prev => new Set(prev).add(projectId));
  }, [setRemoteSideTerminalOpen]);

  return {
    sideTerminalOpenSet,
    setSideTerminalOpen,
    focusedSideTerminalIndex,
    setFocusedSideTerminalIndex,
    sideTerminalOpenSetRef,
    handleOpenSideTerminal,
    handleOpenWslSideTerminal,
    handleOpenRemoteSideTerminal,
  };
}
