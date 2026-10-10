import type { GitInfo } from '@/shared/types/git';
import type { ProjectId } from '@/shared/utils/workspaceRef';

export interface WSLProject {
  id: ProjectId;
  name: string;
  path: string;
  distro: string;
  entry_id: string;
  selected_agents: string[];
  selected_ide: string | null;
  git_info?: GitInfo | null;
  avatar_color?: string | null;
}

export interface WSLEntrySession {
  id: string;
  distro: string;
  projects: WSLProject[];
}

export interface RemoteProject {
  id: ProjectId;
  name: string;
  path: string;
  entry_id: string;
  selected_agents: string[];
  selected_ide: string | null;
  git_info?: GitInfo | null;
  avatar_color?: string | null;
}

export type AuthMethod =
  | { Password: string }
  | { KeyFile: string }
  | { KeyFileWithPassphrase: { key_path: string; passphrase: string } };

export interface RemoteEntrySession {
  id: string;
  host: string;
  port: number;
  username: string;
  projects: RemoteProject[];
  saved_auth?: string | null;
}
