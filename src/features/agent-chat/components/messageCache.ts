import type { ChatMessage } from './messageModel';

/**
 * 模块级消息缓存 —— 按 tabId 键控，解决切换 tab 后组件卸载导致消息丢失的问题。
 * 组件挂载时从缓存恢复消息；消息变更时同步写入缓存。
 * 注意：页面刷新后缓存清空（内存级，非持久化）。
 */
const messageCache = new Map<string, ChatMessage[]>();

/** 清空消息缓存（测试用）。 */
export function clearMessageCache(): void {
  messageCache.clear();
}

/** 从缓存读取消息（深拷贝避免引用共享）。 */
export function loadCachedMessages(tabId: string): ChatMessage[] | undefined {
  const cached = messageCache.get(tabId);
  return cached
    ? cached.map((m) => ({
        ...m,
        blocks: m.blocks.map((b) => (b.kind === 'tool' ? { ...b, tool: { ...b.tool } } : { ...b })),
      }))
    : undefined;
}

/** 将消息写入缓存。 */
export function saveCachedMessages(tabId: string, messages: ChatMessage[]): void {
  messageCache.set(
    tabId,
    messages.map((m) => ({
      ...m,
      blocks: m.blocks.map((b) => (b.kind === 'tool' ? { ...b, tool: { ...b.tool } } : { ...b })),
    })),
  );
}
