/** CHAT 能力：传输协议 + 启动方式（与后端 `ChatStart` 对应）。 */
export type ChatStart = 'acp' | 'serve' | 'jsonl' | 'mock';

/** 安装检测方式（后端 `Detection`，serde tag=type）。 */
export type Detection = { type: 'command'; target: string } | { type: 'directory'; target: string };

/** 部署契约：skills 必填，commands/mcp 可选（Some = 支持该类型部署）。 */
export interface DeploySpec {
  /** skills 目录模板（支持 {{home}} / {{projectPath}}）。 */
  skills: string;
  /** slash commands 目录模板（缺省 = 不支持 command 部署）。 */
  commands?: string | null;
  /** MCP 配置文件模板（缺省 = 不支持 MCP 部署）。 */
  mcp_config?: string | null;
}

export interface AgentConfig {
  id: string;
  name: string;
  icon?: string | null;
  enabled: boolean;
  is_builtin?: boolean;
  /** Executable command path（CLI 能力基础；空 = 无终端 TUI，如 mockAgent）。 */
  command: string;
  args: string[];
  env: Record<string, string>;
  /** CHAT 能力（None = 无 CHAT 能力）。 */
  chat?: ChatStart | null;
  /** prompt 前置参数（Headless 能力；None = 无）。 */
  prompt_args?: string[] | null;
  post_prompt_args?: string[] | null;
  /** 全局 skills 目录 override（如 ~/.claude/skills）。 */
  skill_path?: string | null;
  /** 安装检测（None = 恒视为已安装）。 */
  detection?: Detection | null;
  /** 部署契约（skills / commands / MCP 目标模板）。 */
  deploy?: DeploySpec;
}

/** 派生能力标记（前端计算）。 */
export function agentCapabilities(agent: AgentConfig) {
  return {
    cli: (agent.command ?? '').length > 0,
    chat: Boolean(agent.chat),
    headless: Boolean(agent.prompt_args),
  };
}
