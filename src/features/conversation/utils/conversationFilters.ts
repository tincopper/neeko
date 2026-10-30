import type { AgentConfig } from '@/features/agent/types';

import type { ConversationMeta } from '../types';

/** Agent 筛选 chip 的展示数据。 */
export interface AgentFilterOption {
  id: string;
  count: number;
  agent: AgentConfig | null;
}

/** 未筛选页里每个 agent 的会话数（chip 目录的唯一来源）。 */
export function countByAgent(conversations: ConversationMeta[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of conversations) {
    counts.set(c.agentId, (counts.get(c.agentId) ?? 0) + 1);
  }
  return counts;
}

/** 客户端搜索：只在**已加载**的页里找（agent 筛选是服务端口径，两者不合并）。 */
export function matchesSearch(meta: ConversationMeta, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const title = (meta.userTitle ?? meta.title ?? '').toLowerCase();
  const preview = (meta.preview ?? '').toLowerCase();
  const agentId = (meta.agentId ?? '').toLowerCase();
  return title.includes(q) || preview.includes(q) || agentId.includes(q);
}

/** 过滤已加载页（空 query = 原样返回）。 */
export function filterConversations(
  conversations: ConversationMeta[],
  searchQuery: string,
): ConversationMeta[] {
  const q = searchQuery.trim();
  if (!q) return conversations;
  return conversations.filter((meta) => matchesSearch(meta, q));
}

/**
 * 构建 agent chip 列表。
 *
 * 口径：**选中的 agent 用服务端 `total`**（此时 `conversations` 已被服务端过滤），
 * 其余 agent 保留上次未筛选页的目录计数（`catalog`）。
 */
export function buildAgentOptions({
  catalog,
  agents,
  agentFilter,
  total,
}: {
  catalog: ReadonlyMap<string, number>;
  agents: AgentConfig[];
  agentFilter: string | null;
  total: number;
}): AgentFilterOption[] {
  const ids = [...catalog.keys()];
  if (agentFilter && !ids.includes(agentFilter)) {
    ids.push(agentFilter);
  }
  ids.sort((a, b) => {
    const nameA = agents.find((x) => x.id === a)?.name ?? a;
    const nameB = agents.find((x) => x.id === b)?.name ?? b;
    return nameA.localeCompare(nameB);
  });
  return ids.map((id) => ({
    id,
    count: agentFilter === id ? total : (catalog.get(id) ?? 0),
    agent: agents.find((a) => a.id === id) ?? null,
  }));
}
