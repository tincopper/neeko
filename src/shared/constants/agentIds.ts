/**
 * Built-in agent ID constants.
 *
 * 双端契约的单一事实源：后端（`src-tauri/src/agent/ids.rs`）与前端所有 agent id
 * 字面量分派（action-menu 过滤、composer fallback、终端默认 agent 等）必须引用
 * 此常量表，禁止在业务代码中散落字符串。
 */
export const AGENT_IDS = {
  opencode: 'opencode',
  deepseekHarness: 'deepseek-harness',
  mockAgent: 'mockAgent',
} as const;

export type AgentId = (typeof AGENT_IDS)[keyof typeof AGENT_IDS];
