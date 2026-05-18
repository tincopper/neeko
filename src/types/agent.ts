export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  icon: string | null;
  enabled: boolean;
  skillPath?: string | null;
  /** prompt 前置参数，如 ["--bare", "-p"]。null/undefined 表示该 agent 不支持直接 prompt 模式。 */
  prompt_args?: string[] | null;
  /** prompt 后置参数，追加在 prompt 之后，如 ["--dangerously-skip-permissions"]。 */
  post_prompt_args?: string[] | null;
  /** 是否为内置 agent（由后端 `add_default_agents` 标记）。用户自定义 agent 始终为 false。 */
  is_builtin?: boolean;
  /** 内置 agent 的默认 skill 路径（由后端提供）。用户自定义 agent 始终为 null。 */
  default_skill_path?: string | null;
}
