/**
 * 工具调用分组折叠逻辑 —— 对齐 Synara 文档 §14.2.3。
 *
 * 连续的可汇总工具调用自动折叠为一个摘要披露器：
 * - 至少 MIN_COLLAPSIBLE_TOOL_GROUP_SIZE = 2 个连续工具调用才折叠
 * 分组摘要默认由展示层展开，用户可手动折叠。
 * - 新的叙述行（文本 delta）作为分隔边界
 */

import type { ToolCard } from '../types';

/// 最少连续工具调用数才触发折叠。
export const MIN_COLLAPSIBLE_TOOL_GROUP_SIZE = 2;

/** 工具调用摘要分类。 */
export type ToolCallCategory = 'command' | 'edit' | 'read' | 'search' | 'agent' | 'tool';

/** 对单个工具调用进行分类。 */
export function classifyToolCallCategory(name: string): ToolCallCategory {
  if (name === 'run_command' || name === 'bash') return 'command';
  if (name === 'edit_file' || name === 'write_file') return 'edit';
  if (name === 'read_file') return 'read';
  if (name === 'search' || name === 'grep') return 'search';
  return 'tool';
}

/** 分类 → 人类可读标签。 */
const categoryLabels: Record<ToolCallCategory, string> = {
  command: 'Ran',
  edit: 'Edited',
  read: 'Read',
  search: 'Searched',
  agent: 'Delegated',
  tool: 'Called',
};

/** 分类 → 单数/复数单位。 */
const categoryUnits: Record<ToolCallCategory, [string, string]> = {
  command: ['command', 'commands'],
  edit: ['file', 'files'],
  read: ['file', 'files'],
  search: ['search', 'searches'],
  agent: ['task', 'tasks'],
  tool: ['tool', 'tools'],
};

/** 计数摘要文本，如 "Ran 3 commands · Edited 2 files"。 */
export function summarizeToolGroup(counts: Map<ToolCallCategory, number>): string {
  const parts: string[] = [];
  for (const [cat, count] of counts) {
    if (count <= 0) continue;
    const [singular, plural] = categoryUnits[cat];
    const label = categoryLabels[cat];
    parts.push(`${label} ${count} ${count === 1 ? singular : plural}`);
  }
  return parts.join(' · ') || 'No tool calls';
}

/** 检查组内是否有正在运行的调用。 */
export function hasRunningEntry(tools: ToolCard[]): boolean {
  return tools.some((t) => t.status === 'running');
}

export interface ToolGroup {
  /** 组内工具列表。 */
  tools: ToolCard[];
  /** 分类计数。 */
  counts: Map<ToolCallCategory, number>;
  /** 摘要文本。 */
  summary: string;
  /** 是否有正在运行的调用。 */
  hasRunning: boolean;
}

/** 有专属卡片/消息级展示的工具：不参与折叠分组，作为分隔边界（SkillCard / TaskCard / 消息级 todo）。 */
const DEDICATED_TOOLS = new Set(['skill', 'load_skill', 'task', 'todowrite']);

/** 工具是否可并入折叠组：四类可汇总 + 未知工具（fallback 折叠行同样一体化成组）。 */
function isGroupable(tool: ToolCard): boolean {
  const cat = classifyToolCallCategory(tool.name);
  if (cat === 'command' || cat === 'edit' || cat === 'read' || cat === 'search') return true;
  return cat === 'tool' && !DEDICATED_TOOLS.has(tool.name);
}

/**
 * 将工具列表分组：连续的可汇总工具调用合并为组，
 * 单个工具保持独立。
 */
export function chunkToolGroups(tools: ToolCard[]): (ToolCard | ToolGroup)[] {
  const result: (ToolCard | ToolGroup)[] = [];
  let currentGroup: ToolCard[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 0) return;
    if (currentGroup.length >= MIN_COLLAPSIBLE_TOOL_GROUP_SIZE) {
      const counts = new Map<ToolCallCategory, number>();
      for (const t of currentGroup) {
        const cat = classifyToolCallCategory(t.name);
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
      result.push({
        tools: [...currentGroup],
        counts,
        summary: summarizeToolGroup(counts),
        hasRunning: hasRunningEntry(currentGroup),
      });
    } else {
      // 不足折叠门槛，逐个展开
      for (const t of currentGroup) result.push(t);
    }
    currentGroup = [];
  };

  for (const tool of tools) {
    if (isGroupable(tool)) {
      currentGroup.push(tool);
    } else {
      // 专用卡工具（skill/task）作为分隔
      flushGroup();
      result.push(tool);
    }
  }
  flushGroup();

  return result;
}
