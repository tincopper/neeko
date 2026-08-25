/**
 * Built-in agent ID constants.
 *
 * 前端 agent id 字面量的单一事实源（后端 id 定义在 `src-tauri/src/agent/builtin/`
 * 内置表中）。业务代码中 agent id 分派应引用此常量表，禁止散落字符串。
 * 注意：deepseek-harness 已移除（仅保留 Jsonl 传输供未来自定义 agent 声明）。
 */
export const AGENT_IDS = {
  opencode: 'opencode',
  mockAgent: 'mockAgent',
} as const;

export type AgentId = (typeof AGENT_IDS)[keyof typeof AGENT_IDS];
