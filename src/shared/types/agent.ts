export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  icon: string | null;
  enabled: boolean;
  skill_path?: string | null;
  prompt_args?: string[] | null;
  post_prompt_args?: string[] | null;
  is_builtin?: boolean;
}
