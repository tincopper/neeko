import { invoke } from '@tauri-apps/api/core';

import type { ContextManifest } from '@/shared/types/agentChat';

/**
 * agent-chat 后端命令的 feature API 门面（AGENTS.md：前端不直接 import invoke）。
 *
 * 与 `src-tauri/src/agent/chat/commands.rs` 的 `#[tauri::command]` 一一对应。
 */

/** `agent_stream` 请求体（驼峰命名，serde 映射后端 snake_case）。 */
export interface StreamChatRequest {
  agentId: string;
  projectId: string;
  prompt: string;
  files?: string[];
  skills?: string[];
  mode?: string;
  sessionId?: string;
  /** 用户选择的模型 ID（serve 传输层按 `providerID/modelID` 传给 opencode serve）。 */
  modelId?: string;
}

/** 启动（或续写）一个流式会话，返回 sessionId。 */
export function startAgentChat(req: StreamChatRequest): Promise<string> {
  return invoke<string>('agent_stream', { req });
}

/**
 * 从 agent 原生会话恢复一个流式 Agent Chat（会话静默启动，历史由前端
 * `getConversationMessages` 渲染）。仅支持 `supports_chat_resume` 的 adapter。
 */
export function resumeAgentChat(req: StreamChatRequest, nativeSessionId: string): Promise<string> {
  return invoke<string>('agent_chat_resume', { req, nativeSessionId });
}

/** 该 agent 的 adapter 是否支持把原生会话恢复为 Agent Chat。 */
export function supportsAgentChatResume(agentId: string): Promise<boolean> {
  return invoke<boolean>('agent_chat_supports_resume', { agentId });
}

/** 审批回执（Gate 返回）：允许/拒绝某个 pending 工具调用。 */
export function approveAgentCall(sessionId: string, callId: string, allow: boolean): Promise<void> {
  return invoke<void>('agent_approve', { sessionId, callId, allow });
}

/** 向 agent 发送澄清输入（AskUserQuestion 回程）。 */
export function sendAgentInput(sessionId: string, turnId: string, prompt: string): Promise<void> {
  return invoke<void>('agent_input', { sessionId, turnId, prompt });
}

/** 取消当前流（agent_stream_cancel）。 */
export function cancelAgentStream(sessionId: string): Promise<void> {
  return invoke<void>('agent_stream_cancel', { sessionId });
}

/** 重绑上下文（agent_context_set，A4）。 */
export function setAgentContext(sessionId: string, manifest: ContextManifest): Promise<void> {
  return invoke<void>('agent_context_set', { sessionId, manifest });
}
