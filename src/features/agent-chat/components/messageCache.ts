import type { ChatMessage } from './messageModel';

/**
 * 模块级消息缓存 —— 按 tabId 键控，解决切换 tab 后组件卸载导致消息丢失的问题。
 * 组件挂载时从缓存恢复消息；消息变更时同步写入缓存。
 * 注意：页面刷新后缓存清空（内存级，非持久化）。
 */
const messageCache = new Map<string, ChatMessage[]>();

/** 缓存的最大会话数：超出后移除最早条目（近似 LRU，按 Map 插入序）。 */
const MAX_CACHED_SESSIONS = 12;

/** 清空消息缓存（测试用）。 */
export function clearMessageCache(): void {
  messageCache.clear();
}

/** 移除指定 tab 的消息缓存（tab 关闭时调用，防只增不删的内存残留）。 */
export function removeCachedMessages(tabId: string): void {
  messageCache.delete(tabId);
}

/** 从缓存读取消息（共享引用，调用方禁止就地修改返回值）。
 * @readonly — ChatMessage 全链路为不可变更新（appendDelta/appendBlock 均纯函数，
 * 从不就地修改），直接共享引用即可 —— 旧实现每次读都深拷贝整个数组，
 * 长会话下 GC 压力显著。若需修改请先展开拷贝。 */
export function loadCachedMessages(tabId: string): ChatMessage[] | undefined {
  return messageCache.get(tabId);
}

/** 将消息写入缓存（共享引用，不拷贝：写入的是不可变的 React state 快照）。 */
export function saveCachedMessages(tabId: string, messages: ChatMessage[]): void {
  messageCache.set(tabId, messages);
  // 容量治理：超出上限移除最早插入的条目
  while (messageCache.size > MAX_CACHED_SESSIONS) {
    const oldest = messageCache.keys().next().value;
    if (oldest === undefined) break;
    messageCache.delete(oldest);
  }
}
