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
  central_path: string;
  enabled: boolean;
  status: string;
  update_status: string;
  tags: string[];
  created_at: number;
  updated_at: number;
}

export interface ToolInfo {
  key: string;
  display_name: string;
  installed: boolean;
  has_override: boolean;
  is_custom: boolean;
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

export interface SkillToolToggle {
  tool: string;
  display_name: string;
  enabled: boolean;
  installed: boolean;
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

// Marketplace types
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
