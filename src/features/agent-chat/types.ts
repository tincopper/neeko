/**
 * agent-chat UI 层类型（feature 内共享）。
 *
 * 与 `src/shared/types/agentChat.ts` 的协议事件对应，但专用于页面渲染结构：
 * - `ToolCard` 由 `tool_start` / `tool_output` / `tool_end` / `command_run` 驱动；
 * - `FileChangeSummary` 由 `file_diff` 聚合（Files changed 卡片）；
 * - `WorkedSummary` 由话轮生命周期（`turn_start` / `turn_end`）聚合（worked-card）。
 */

export interface ToolCard {
  callId: string;
  name: string;
  title: string;
  status: 'running' | 'done' | 'failed';
  output?: string;
}

export interface FileStat {
  path: string;
  add: number;
  del: number;
}

export interface FileDiff {
  path: string;
  diff: string;
}

/** Files changed 卡片数据（由 file_diff 事件聚合）。 */
export interface FileChangeSummary {
  files: FileStat[];
  diffs: FileDiff[];
}

/** 话轮摘要卡片数据（"Worked for Xs"）。 */
export interface WorkedSummary {
  durationMs: number;
  ran: number;
  edited: number;
  searched: number;
  tools: ToolCard[];
}

/** 待审批项（request_approval 事件负载）。 */
export interface PendingApproval {
  callId: string;
  tool: string;
  title: string;
  prompt: string;
  diff?: string | null;
  cmd?: string | null;
  /** 本次会话内第几个审批请求（显示 1/2 计数用）。 */
  index: number;
  total: number;
}
