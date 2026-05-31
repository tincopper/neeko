import type { RemoteEntrySession } from "@/features/connection/types";
import type { ProjectData } from "@/features/project/types";

export interface WslProjectAdapter {
  type: "wsl";
  distro: string;
  project: ProjectData;
}

export interface RemoteProjectAdapter {
  type: "remote";
  entry: RemoteEntrySession;
  project: ProjectData;
}

export type ActiveProjectAdapter =
  | { type: "local"; project: ProjectData }
  | WslProjectAdapter
  | RemoteProjectAdapter;
