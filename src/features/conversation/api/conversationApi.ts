import { invoke } from '@tauri-apps/api/core';

import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

import type {
  ConversationListPage,
  ConversationMeta,
  ConversationMessage,
  ConversationMessagePage,
  ConversationSearchHit,
  ConversationStats,
  ScanReport,
} from '../types';

export function scanConversations(agentId?: string, projectPath?: string): Promise<ScanReport[]> {
  return invoke<ScanReport[]>('scan_conversations', { agentId, projectPath });
}

/**
 * 会话列表的**范围**（与后端 `ConversationListScope` 逐字同形）。
 *
 * 项目级与单元级对同一条会话的 cwd 给出**不同**答案，所以是判别联合而不是「两个可选过滤参数」：
 * 后者允许调用方同时传两个维度、后端静默丢掉一个 —— 那正是「要单元却按项目过滤」的入口。
 */
export type ConversationListScope =
  | { kind: 'project'; path: string }
  | { kind: 'unit'; workspace: WorkspaceSession };

/**
 * List conversations for **one explicit scope**.
 * Pass `limit` for paged infinite scroll; omit/`0` for full list.
 *
 * 单元级（`kind: 'unit'`）的归属判定在后端按「最深根胜出」完成（`UnitScope`），
 * 前端只给地址、不拼路径（红线 12）。
 */
export function listConversations(
  scope: ConversationListScope,
  agentId?: string,
  options?: { offset?: number; limit?: number },
): Promise<ConversationListPage> {
  return invoke<ConversationListPage>('list_conversations', {
    scope,
    agentId,
    offset: options?.offset ?? 0,
    limit: options?.limit ?? 0,
  });
}

/**
 * 拉取一页正文；每页由 Rust 侧按 1.5MB 预算切分（红线 4）。
 *
 * `fromEnd: true` 时 `offset` 表示「跳过末尾多少条」，正文视图用它取尾页与更早的页。
 */
export function getConversationMessagesPage(
  id: string,
  offset = 0,
  options?: { fromEnd?: boolean },
): Promise<ConversationMessagePage> {
  return invoke<ConversationMessagePage>('get_conversation_messages', {
    id,
    offset,
    fromEnd: options?.fromEnd ?? false,
  });
}

/** 正文统计（工具调用清单 / thinking 计数）：Rust 侧计算，避免前端为计数持有全量正文。 */
export function getConversationStats(id: string): Promise<ConversationStats> {
  return invoke<ConversationStats>('get_conversation_stats', { id });
}

/** 正文内搜索：返回命中定位与片段（视图按 `seq` 加载定位页）。 */
export function searchConversationMessages(
  id: string,
  query: string,
): Promise<ConversationSearchHit[]> {
  return invoke<ConversationSearchHit[]>('search_conversation_messages', { id, query });
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

/**
 * 删除一条历史会话。
 *
 * **只传 id**：目标路径由后端从自己的缓存解析 —— 渲染层无法指定要删哪个文件
 * （红旗 8 的同源风险：传路径 = 任意文件删除口子）。
 */
export function deleteConversation(id: string): Promise<void> {
  return invoke<void>('delete_conversation', { id });
}

/**
 * 把整段会话以 Markdown 写入系统剪贴板，返回写入的字符数。
 *
 * 正文在 Rust 侧生成并直接写剪贴板 —— 不经 IPC 回传（红线 4）。
 */
export function copyConversationMarkdown(id: string): Promise<number> {
  return invoke<number>('copy_conversation_markdown', { id });
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
