import type { RemoteEntrySession } from "./connection";
import type { UnifiedProject } from "./project";

export interface WslProjectAdapter {
  type: "wsl";
  distro: string;
  project: UnifiedProject;
}

export interface RemoteProjectAdapter {
  type: "remote";
  entry: RemoteEntrySession;
  project: UnifiedProject;
}

export type ActiveProjectAdapter =
  | { type: "local"; project: UnifiedProject }
  | WslProjectAdapter
  | RemoteProjectAdapter;
