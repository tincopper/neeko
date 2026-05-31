import type { RemoteEntrySession } from "@/features/connection/types";
import type { UnifiedProject } from "@/features/project/types";

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
