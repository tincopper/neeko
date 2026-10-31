import { invoke } from '@tauri-apps/api/core';

import type { AgentCommandEntry, ContextManifest } from '@/shared/types/agentChat';
import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * agent-chat 后端命令的 feature API 门面（AGENTS.md：前端不直接 import invoke）。
 *
 * 与 `src-tauri/src/agent/chat/commands.rs` 的 `#[tauri::command]` 一一对应。
 */

/** `agent_stream` 请求体（驼峰命名，serde 映射后端 snake_case）。 */
export interface StreamChatRequest {
  agentId: string;
  /**
   * **执行地址**（必填）：agent 进程的 cwd 由后端按它解析。
   *
   * 为什么必填而不是「缺省按项目」：worktree 单元与主仓是两个执行上下文，缺地址只会让 agent
   * 静默跑在主仓（读错文件、写错文件），而 pi/opencode 的原生 resume 还要求 cwd == 会话 origin。
   * 前端只有一个铸造点（`activeWorkspaceSession`），漏传即编译失败。
   */
  workspace: WorkspaceSession;
  prompt: string;
  files?: string[];
  skills?: string[];
  mode?: string;
  sessionId?: string;
  /** 用户选择的模型 ID（serve 传输层按 `providerID/modelID` 传给 opencode serve）。 */
  modelId?: string;
  /**
   * 会话主题（R7.4）：恢复既有会话时传 agent 原生标题（conversation 的
   * `userTitle` 优先，回退 `title`）；新会话留空 —— 后端回退首轮 prompt。
   */
  topic?: string;
}

/** 启动（或续写）一个流式会话，返回 sessionId。 */
export function startAgentChat(req: StreamChatRequest): Promise<string> {
  return invoke<string>('agent_stream', { req });
}

/**
 * 打开一个**静默会话**：建会话拿 `configOptions`，但不发 prompt。
 *
 * 用于「选中 agent 就先把工具条填满」—— 模型 / 推理档位 / 模式都只在会话的
 * `configOptions` 里，等发第一条消息才建会话会让这些选择器先缺席再出现。
 * 之后 `startAgentChat` 会走续聊分支复用同一会话。
 */
export function openAgentChat(req: StreamChatRequest): Promise<string> {
  return invoke<string>('agent_chat_open', { req });
}

/**
 * 从 agent 原生会话恢复一个流式 Agent Chat（会话静默启动，历史由前端
 * `getConversationMessages` 渲染）。仅支持 `supports_chat_resume` 的 adapter。
 */
export function resumeAgentChat(req: StreamChatRequest, nativeSessionId: string): Promise<string> {
  return invoke<string>('agent_chat_resume', { req, nativeSessionId });
}

/** 取 agent 的 slash 命令列表（`/` 补全数据源；会话外独立查询）。
 *
 * 入口显隐不靠本查询报错判定 —— 由 `SessionStart.capabilities.commands`
 * 能力位门控（能力位 false 时调用方根本不发这条查询）。
 */
/**
 * @param directory 项目根路径（可选）。opencode 的项目级命令
 *   （`<project>/.opencode/commands/**`）只在该参数存在时被纳入。
 */
export function listAgentCommands(
  agentId: string,
  directory?: string,
): Promise<AgentCommandEntry[]> {
  return invoke<AgentCommandEntry[]>('list_agent_commands', { agentId, directory });
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

/** 设置一个会话配置项（session/set_config_option）。 */
export function setAgentConfigOption(
  sessionId: string,
  configId: string,
  value: string | boolean,
): Promise<void> {
  return invoke<void>('agent_set_config_option', { sessionId, configId, value });
}

/** 取消当前流（agent_stream_cancel）。 */
export function cancelAgentStream(sessionId: string): Promise<void> {
  return invoke<void>('agent_stream_cancel', { sessionId });
}

/** 重绑上下文（agent_context_set，A4）。 */
export function setAgentContext(sessionId: string, manifest: ContextManifest): Promise<void> {
  return invoke<void>('agent_context_set', { sessionId, manifest });
}

/**
 * 上报当前对用户可见的 chat 会话（通知焦点抑制 R2.1 的事实来源；
 * `null` = 用户当前看的不 chat 会话）。失败静默 —— 不影响会话本身。
 */
export function setVisibleChatSession(sessionId: string | null): Promise<void> {
  return invoke<void>('agent_chat_set_visible', { sessionId });
}
