import type { ProjectId } from '@/shared/utils/workspaceRef';

/**
 * 终端 tab 的**视图形态**（TabBar 消费）。
 *
 * 只携带身份 + 展示字段：运行状态不在这里 —— 它是 live-sessions 注册表的事实，
 * 视图持有副本就是「图标固定不动」那类事故的来源。
 */
export interface TerminalTab {
  id: string;
  projectId: ProjectId;
  agentId: string | null;
  title: string;
}
