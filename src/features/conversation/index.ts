export type { ConversationMeta, ConversationMessage, ScanReport } from './types';

export {
  scanConversations,
  listConversations,
  getConversationMessages,
  getConversationMessagesPage,
  searchConversations,
  updateConversation,
  getResumeCommand,
  copyConversationMarkdown,
} from './api/conversationApi';

export { useConversationList } from './hooks/useConversationList';
export { useConversationDetail } from './hooks/useConversationDetail';
export { useConversationResume } from './hooks/useConversationResume';

export { default as ConversationPanel } from './components/ConversationPanel';
export { default as ConversationList } from './components/ConversationList';
export { default as ConversationItem } from './components/ConversationItem';
export { default as ConversationViewer } from './components/ConversationViewer';
export { default as ConversationMsg } from './components/ConversationMessage';

// Utils
export { conversationTabTitle } from './utils/conversationTabTitle';

// Utils（容器层编排）
export { runConversationDelete, canDeleteConversation } from './utils/conversationDelete';
export {
  isConversationLiveInChat,
  conversationLiveChatTabRefs,
  conversationViewerTabRefs,
  flattenTabSpaces,
} from './utils/conversationInUse';

// 会话地址铸造点（`agentId:nativeSessionId`）—— 侧栏 / 团队 / 历史列表共用同一份
export { conversationIdOf, parseConversationId } from './utils/conversationId';
