import { describe, expect, it } from 'vitest';

import type { ToolCard } from '../../types';
import {
  chunkToolGroups,
  classifyToolCallCategory,
  summarizeToolGroup,
  type ToolCallCategory,
  type ToolGroup,
} from '../toolCallGroup';

function makeTool(name: string, status: ToolCard['status'] = 'done'): ToolCard {
  return { callId: `c_${name}_${Math.random()}`, name, title: name, status };
}

describe('chunkToolGroups', () => {
  it('不足 2 个工具时不折叠', () => {
    const groups = chunkToolGroups([makeTool('read_file')]);
    expect(groups).toHaveLength(1);
    expect(Array.isArray(groups)).toBe(true);
  });

  it('2 个连续可汇总工具折叠为一组', () => {
    const groups = chunkToolGroups([makeTool('read_file'), makeTool('edit_file')]);
    expect(groups).toHaveLength(1);
    const group = groups[0] as ToolGroup;
    expect(group.tools).toHaveLength(2);
    expect(group.summary).toContain('Read 1 file');
    expect(group.summary).toContain('Edited 1 file');
  });

  it('正在运行的组标记 hasRunning', () => {
    const groups = chunkToolGroups([makeTool('read_file', 'running'), makeTool('edit_file')]);
    const group = groups[0] as ToolGroup;
    expect(group.hasRunning).toBe(true);
  });

  it('不可汇总工具作为分隔边界（专用卡片类：skill/task）', () => {
    const groups = chunkToolGroups([
      makeTool('read_file'),
      makeTool('edit_file'),
      makeTool('skill'),
      makeTool('search'),
      makeTool('grep'),
    ]);
    // [read, edit] + skill(独立 SkillCard) + [search, grep]
    expect(groups).toHaveLength(3);
    expect((groups[0] as ToolGroup).tools).toHaveLength(2);
    expect((groups[1] as ToolCard).name).toBe('skill');
    expect((groups[2] as ToolGroup).tools).toHaveLength(2);
  });

  it('连续未知工具（fallback 行）合并为一个可折叠组', () => {
    const groups = chunkToolGroups([makeTool('patch'), makeTool('result'), makeTool('mcp_tool')]);
    expect(groups).toHaveLength(1);
    const group = groups[0] as ToolGroup;
    expect(group.tools).toHaveLength(3);
    expect(group.summary).toContain('Called 3 tools');
  });

  it('未知工具与命令工具相邻时并入同一组', () => {
    const groups = chunkToolGroups([makeTool('exec_command'), makeTool('patch')]);
    expect(groups).toHaveLength(1);
    expect((groups[0] as ToolGroup).tools).toHaveLength(2);
  });

  it('空列表返回空数组', () => {
    expect(chunkToolGroups([])).toEqual([]);
  });
});

describe('classifyToolCallCategory', () => {
  it('分类映射正确', () => {
    expect(classifyToolCallCategory('run_command')).toBe('command');
    expect(classifyToolCallCategory('edit_file')).toBe('edit');
    expect(classifyToolCallCategory('read_file')).toBe('read');
    expect(classifyToolCallCategory('search')).toBe('search');
    expect(classifyToolCallCategory('mcp_tool')).toBe('tool');
  });
});

describe('summarizeToolGroup', () => {
  it('生成正确的摘要文本', () => {
    const counts = new Map([
      ['command', 3],
      ['edit', 2],
    ] as [ToolCallCategory, number][]);
    expect(summarizeToolGroup(counts)).toBe('Ran 3 commands · Edited 2 files');
  });

  it('单数形式', () => {
    const counts = new Map([['command', 1]] as [ToolCallCategory, number][]);
    expect(summarizeToolGroup(counts)).toBe('Ran 1 command');
  });
});
