import { invoke } from '@tauri-apps/api/core';

/**
 * 文档翻译后端命令的 API 门面（AGENTS.md：前端不直接 import invoke）。
 *
 * 与 `src-tauri/src/agent/chat/translation.rs` 对应；取消复用
 * `agent_stream_cancel`（翻译会话注册在同一个 manager，`tr_` 前缀标识）。
 */

/** `translation_stream` 请求体（驼峰命名，serde 映射后端 snake_case）。 */
export interface TranslationStreamRequest {
  agentId: string;
  projectId: string;
  /** 前端管线组装好的完整翻译 prompt */
  prompt: string;
  /** 用户选择的模型 ID；缺省走 agent 默认 */
  modelId?: string;
}

/** 启动一个翻译 turn（事件流走 `translation://event`），返回 sessionId。 */
export function startTranslation(req: TranslationStreamRequest): Promise<string> {
  return invoke<string>('translation_stream', { req });
}

/** 取消进行中的翻译 turn（复用 agent 会话取消命令）。 */
export function cancelTranslation(sessionId: string): Promise<void> {
  return invoke<void>('agent_stream_cancel', { sessionId });
}
