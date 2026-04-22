export type PaneId = string;
export type PaneDirection = "horizontal" | "vertical";
export type SplitPathStep = "first" | "second";

export type PaneNode =
  | { type: "leaf"; paneId: PaneId }
  | {
      type: "split";
      direction: PaneDirection;
      ratio: number;
      first: PaneNode;
      second: PaneNode;
    };

export interface SplitState {
  root: PaneNode;
  activePaneId: PaneId;
  paneCount: number;
}
