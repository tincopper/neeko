/**
 * `conversationId` 的**唯一铸造点**（`agentId:nativeId` 复合键）。
 *
 * # 为什么必须单点
 *
 * 复合键格式是 Rust 侧的契约：`conversation/manager.rs::parse_conversation_id` 按
 * **第一个 `:`** 切分（native id 自身可以含 `:` —— codex 的
 * `2025/01/01/session-uuid` 就不是唯一形态，但含冒号是允许的）。前端多点各自
 * 模板拼接，一旦后端改格式（转义 / 换分隔符）就是静默失联：
 * 请求发出去、后端说「会话不存在」，而数据和 UI 都看不出为什么。
 *
 * 与 terminal 寻址域的对应物（`terminalAddress` 唯一 mint，禁止消费侧手拼键形态）
 * 是同一条纪律。
 *
 * # 谁调用
 *
 * - 后端产出 `ConversationMeta.id` 的消费点**直接用 `meta.id`**（它是权威值）；
 * - 只有「手上只有 agent 与 native id」的场景（团队成员的已退出历史会话）才调本函数。
 *   目前唯一调用点：`TeamPanelWrapper`。
 */
export function conversationIdOf(agentId: string, nativeSessionId: string): string {
  return `${agentId}:${nativeSessionId}`;
}

/**
 * 拆回 `[agentId, nativeId]`；格式不合法（无分隔符 / 任一段为空）时返回 `null`。
 *
 * 与 Rust `parse_conversation_id` 同判据：按**第一个** `:` 切分，native 段可含 `:`。
 * 仅供需要读回两段的展示/调试路径使用 —— 业务判定请用 `meta.agentId` 等结构化字段。
 */
export function parseConversationId(
  conversationId: string,
): { agentId: string; nativeSessionId: string } | null {
  const colon = conversationId.indexOf(':');
  if (colon <= 0) return null;
  const agentId = conversationId.slice(0, colon);
  const nativeSessionId = conversationId.slice(colon + 1);
  if (agentId === '' || nativeSessionId === '') return null;
  return { agentId, nativeSessionId };
}
