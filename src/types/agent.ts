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
}
