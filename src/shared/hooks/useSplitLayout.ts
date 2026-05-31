import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneDirection, PaneId, PaneNode, SplitPathStep, SplitState } from '@/shared/types';

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

export function clampRatio(ratio: number): number {
  if (ratio < MIN_RATIO) return MIN_RATIO;
  if (ratio > MAX_RATIO) return MAX_RATIO;
  return ratio;
}

export function countPanes(node: PaneNode): number {
  if (node.type === "leaf") return 1;
  return countPanes(node.first) + countPanes(node.second);
}

function hasPane(node: PaneNode, paneId: PaneId): boolean {
  if (node.type === "leaf") return node.paneId === paneId;
  return hasPane(node.first, paneId) || hasPane(node.second, paneId);
}

function firstLeafPaneId(node: PaneNode): PaneId {
  if (node.type === "leaf") return node.paneId;
  return firstLeafPaneId(node.first);
}

function splitLeafNode(
  node: PaneNode,
  paneId: PaneId,
  direction: PaneDirection,
  nextPaneId: PaneId
): { nextNode: PaneNode; changed: boolean } {
  if (node.type === "leaf") {
    if (node.paneId !== paneId) {
      return { nextNode: node, changed: false };
    }
    return {
      changed: true,
      nextNode: {
        type: "split",
        direction,
        ratio: 0.5,
        first: node,
        second: { type: "leaf", paneId: nextPaneId },
      },
    };
  }

  const left = splitLeafNode(node.first, paneId, direction, nextPaneId);
  if (left.changed) {
    return {
      changed: true,
      nextNode: {
        ...node,
        first: left.nextNode,
      },
    };
  }

  const right = splitLeafNode(node.second, paneId, direction, nextPaneId);
  if (right.changed) {
    return {
      changed: true,
      nextNode: {
        ...node,
        second: right.nextNode,
      },
    };
  }

  return { nextNode: node, changed: false };
}

function closeLeafNode(
  node: PaneNode,
  paneId: PaneId
): { nextNode: PaneNode; changed: boolean; fallbackPaneId: PaneId | null } {
  if (node.type === "leaf") {
    return {
      nextNode: node,
      changed: false,
      fallbackPaneId: null,
    };
  }

  if (node.first.type === "leaf" && node.first.paneId === paneId) {
    return {
      changed: true,
      nextNode: node.second,
      fallbackPaneId: firstLeafPaneId(node.second),
    };
  }

  if (node.second.type === "leaf" && node.second.paneId === paneId) {
    return {
      changed: true,
      nextNode: node.first,
      fallbackPaneId: firstLeafPaneId(node.first),
    };
  }

  const left = closeLeafNode(node.first, paneId);
  if (left.changed) {
    return {
      changed: true,
      nextNode: {
        ...node,
        first: left.nextNode,
      },
      fallbackPaneId: left.fallbackPaneId,
    };
  }

  const right = closeLeafNode(node.second, paneId);
  if (right.changed) {
    return {
      changed: true,
      nextNode: {
        ...node,
        second: right.nextNode,
      },
      fallbackPaneId: right.fallbackPaneId,
    };
  }

  return {
    nextNode: node,
    changed: false,
    fallbackPaneId: null,
  };
}

export function updateSplitRatio(
  node: PaneNode,
  path: SplitPathStep[],
  ratio: number
): PaneNode {
  if (path.length === 0) {
    if (node.type !== "split") return node;
    return {
      ...node,
      ratio: clampRatio(ratio),
    };
  }

  if (node.type !== "split") return node;

  const [head, ...rest] = path;
  if (head === "first") {
    return {
      ...node,
      first: updateSplitRatio(node.first, rest, ratio),
    };
  }

  return {
    ...node,
    second: updateSplitRatio(node.second, rest, ratio),
  };
}

interface UseSplitLayoutResult {
  state: SplitState;
  splitPane: (paneId: PaneId, direction: PaneDirection) => PaneId | null;
  closePane: (paneId: PaneId) => void;
  setRatio: (path: SplitPathStep[], ratio: number) => void;
  setActivePaneId: (paneId: PaneId) => void;
  canSplit: boolean;
  resetLayout: () => void;
}

function initialState(): SplitState {
  return {
    root: {
      type: "leaf",
      paneId: "p1",
    },
    activePaneId: "p1",
    paneCount: 1,
  };
}

export function useSplitLayout(layoutId: string, maxPanes = 4): UseSplitLayoutResult {
  const [state, setState] = useState<SplitState>(() => initialState());
  const paneSeqRef = useRef(1);

  useEffect(() => {
    paneSeqRef.current = 1;
    setState(initialState());
  }, [layoutId]);

  const canSplit = useMemo(() => state.paneCount < maxPanes, [state.paneCount, maxPanes]);

  const splitPane = useCallback(
    (paneId: PaneId, direction: PaneDirection): PaneId | null => {
      if (!canSplit) return null;

      let createdPaneId: PaneId | null = null;
      setState((prev) => {
        if (!hasPane(prev.root, paneId) || prev.paneCount >= maxPanes) {
          return prev;
        }

        paneSeqRef.current += 1;
        const nextPaneId = `p${paneSeqRef.current}`;
        const result = splitLeafNode(prev.root, paneId, direction, nextPaneId);

        if (!result.changed) {
          paneSeqRef.current -= 1;
          return prev;
        }

        createdPaneId = nextPaneId;
        return {
          root: result.nextNode,
          paneCount: prev.paneCount + 1,
          activePaneId: nextPaneId,
        };
      });

      return createdPaneId;
    },
    [canSplit, maxPanes]
  );

  const closePane = useCallback((paneId: PaneId) => {
    setState((prev) => {
      if (prev.paneCount <= 1 || !hasPane(prev.root, paneId)) {
        return prev;
      }

      const result = closeLeafNode(prev.root, paneId);
      if (!result.changed) return prev;

      const nextActive =
        prev.activePaneId === paneId
          ? result.fallbackPaneId ?? firstLeafPaneId(result.nextNode)
          : prev.activePaneId;

      return {
        root: result.nextNode,
        paneCount: prev.paneCount - 1,
        activePaneId: nextActive,
      };
    });
  }, []);

  const setRatio = useCallback((path: SplitPathStep[], ratio: number) => {
    setState((prev) => ({
      ...prev,
      root: updateSplitRatio(prev.root, path, ratio),
    }));
  }, []);

  const setActivePaneId = useCallback((paneId: PaneId) => {
    setState((prev) => {
      if (!hasPane(prev.root, paneId) || prev.activePaneId === paneId) {
        return prev;
      }
      return {
        ...prev,
        activePaneId: paneId,
      };
    });
  }, []);

  const resetLayout = useCallback(() => {
    paneSeqRef.current = 1;
    setState(initialState());
  }, []);

  return {
    state,
    splitPane,
    closePane,
    setRatio,
    setActivePaneId,
    canSplit,
    resetLayout,
  };
}
