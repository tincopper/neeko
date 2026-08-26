import { registerTabCleanup } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types/tab';

import { cancelAgentStream } from '../api/agentChatApi';
import { removeCachedMessages } from '../components/messageCache';

/**
 * Agent Chat Tab 关闭清理 handler。
 * 停止进行中的流（agent_stream_cancel）、清理 per-tab 状态与消息缓存
 * （防 messageCache 只增不删的内存残留，内存治理 P2）。
 */
const webAgentTabCleanupHandler = (tabKey: string, tab: Tab): void => {
  if (tab.data.kind !== 'agent-chat') return;
  removeCachedMessages(tab.id);
  const sessionId = tab.data.sessionId;
  if (!sessionId) return;
  void cancelAgentStream(sessionId).catch(() => undefined);
  void tabKey;
};

// 模块加载即注册（幂等）。key 必须与 tab.data.kind 一致（runTabCleanup 按 kind 分发）。
registerTabCleanup('agent-chat', webAgentTabCleanupHandler);
