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
  /** Agent chat IO transport: `acp` (JSON-RPC stdio) | `jsonl` (JSON-Lines stdio) | unset (default). */
  chat_transport?: string;
  /** Model IDs this agent supports in Agent Chat (empty = not configured). */
  models?: string[];
}
