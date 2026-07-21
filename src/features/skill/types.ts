export interface SkillRecord {
  id: string;
  name: string;
  description: string | null;
  source_type: "local" | "git";
  source_ref: string | null;
  central_path: string;
  content_hash: string | null;
  enabled: boolean;
  status: string;
  update_status: "up_to_date" | "update_available" | "unknown";
  tags: string[];
  created_at: number;
  updated_at: number;
}

export interface ManagedSkillDto {
  id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_ref: string | null;
  source_ref_resolved: string | null;
  source_subpath: string | null;
  source_branch: string | null;
  source_revision: string | null;
  remote_revision: string | null;
  central_path: string;
  enabled: boolean;
  status: string;
  update_status: string;
  tags: string[];
  last_checked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TagGroup {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  skill_count: number;
}

export interface SkillTargetRecord {
  id: string;
  skill_id: string;
  tool: string;
  target_path: string;
  mode: "symlink" | "copy";
  status: string;
  synced_at: number | null;
}

export interface SkillDocumentDto {
  content: string;
}

export interface DiscoveredSkillDto {
  id: string;
  tool: string;
  found_path: string;
  name_guess: string | null;
}

export type LeaderboardType = "hot" | "trending" | "alltime";

export interface SkillsShSkill {
  id: string;
  skill_id: string;
  name: string;
  source: string;
  installs: number;
}

export interface InstallProgress {
  skill_id: string;
  phase: "cloning" | "installing" | "done" | "error";
  error?: string;
}

export interface AgentDiskSkill {
  name: string;
  description: string | null;
  path: string;
  managed: boolean;
  skill_id: string | null;
}

export interface AgentSkillGroup {
  agent_id: string;
  agent_name: string;
  agent_icon: string | null;
  agent_enabled: boolean;
  agent_skill_path: string | null;
  skills: AgentDiskSkill[];
}
