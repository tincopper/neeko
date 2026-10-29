import { invoke } from '@tauri-apps/api/core';

import type {
  ConversationListPage,
  ConversationMeta,
  ConversationMessage,
  ConversationMessagePage,
  ScanReport,
} from '../types';

export function scanConversations(agentId?: string, projectPath?: string): Promise<ScanReport[]> {
  return invoke<ScanReport[]>('scan_conversations', { agentId, projectPath });
}

/**
 * List conversations for a project (strict project ownership).
 * Pass `limit` for paged infinite scroll; omit/`0` for full list.
 */
export function listConversations(
  projectPath?: string,
  agentId?: string,
  options?: { offset?: number; limit?: number },
): Promise<ConversationListPage> {
  return invoke<ConversationListPage>('list_conversations', {
    projectPath,
    agentId,
    offset: options?.offset ?? 0,
    limit: options?.limit ?? 0,
  });
}

/** 拉取一页正文；每页由 Rust 侧按 1.5MB 预算切分（红线 4）。 */
export function getConversationMessagesPage(
  id: string,
  offset = 0,
): Promise<ConversationMessagePage> {
  return invoke<ConversationMessagePage>('get_conversation_messages', { id, offset });
}

/**
 * 拉取完整正文：逐页组装，保证单次 IPC 载荷在预算内。
 *
 * 需要「整段会话」的调用方（视图渲染 / 统计 / 工具面板 / 会话恢复）继续保持这个签名，
 * 只是背后的传输变成多页 —— 语义与内存占用不变，只有单次载荷被约束住。
 */
export async function getConversationMessages(id: string): Promise<ConversationMessage[]> {
  const messages: ConversationMessage[] = [];
  let offset = 0;
  for (;;) {
    const page = await getConversationMessagesPage(id, offset);
    messages.push(...page.items);
    if (!page.hasMore || page.items.length === 0) {
      return messages;
    }
    offset = page.offset + page.items.length;
  }
}

export function searchConversations(
  query: string,
  projectPath?: string,
): Promise<ConversationMeta[]> {
  return invoke<ConversationMeta[]>('search_conversations', { query, projectPath });
}

export function updateConversation(id: string, userTitle?: string, tags?: string[]): Promise<void> {
  return invoke<void>('update_conversation', { id, userTitle, tags });
}

export function getResumeCommand(id: string): Promise<string[] | null> {
  return invoke<string[] | null>('get_resume_command', { id });
}

export function exportConversation(id: string): Promise<string> {
  return invoke<string>('export_conversation', { id });
}

/** Backend emits this while `scan_conversations` runs (Stage C progress). */
export const CONVERSATION_SCAN_PROGRESS_EVENT = 'conversation-scan-progress';

export interface ConversationScanProgressEvent {
  agentId: string;
  /** `start` | `done` | `error` */
  phase: string;
  sessionsFound: number;
  projectPath?: string | null;
}
