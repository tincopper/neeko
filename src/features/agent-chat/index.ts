/// <reference types="react" />
export { default as AgentChatTabView } from './components/AgentChatTabView';
export type { AgentChatTabData } from '@/shared/types/tab';

// 公开面（跨 feature / app 层消费的唯一入口）。门面缺符号时**先补导出**再改消费方，
// 不要在消费方深引 `hooks/` `components/` `utils/` —— 那会让本域的内部结构变成事实上的 API。
export { useChatResumableAgents } from './hooks/useChatResumableAgents';
