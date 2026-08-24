import { describe, expect, it } from 'vitest';

import type { MessageBlock } from '../../types';
import { pairToolBlocks, type ToolBlockGroup } from '../pairToolBlocks';

const toolUse = (id: string, name = 'Bash'): MessageBlock => ({
  type: 'toolUse',
  id,
  name,
  input: { command: 'ls' },
});

const toolResult = (toolUseId: string, isError = false): MessageBlock => ({
  type: 'toolResult',
  toolUseId,
  content: 'done',
  isError,
});

function groupOf(block: MessageBlock | ToolBlockGroup): ToolBlockGroup | null {
  return block.type === 'tool' ? (block as ToolBlockGroup) : null;
}

describe('pairToolBlocks', () => {
  it('pairs a toolUse with its matching toolResult', () => {
    const blocks = [toolUse('t1'), toolResult('t1')];
    const out = pairToolBlocks(blocks);
    expect(out).toHaveLength(1);
    const group = groupOf(out[0]);
    expect(group).not.toBeNull();
    expect(group!.toolUse.id).toBe('t1');
    expect(group!.toolResult?.toolUseId).toBe('t1');
  });

  it('keeps a toolUse without a matching result standalone', () => {
    const blocks = [toolUse('t1')];
    const out = pairToolBlocks(blocks);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('toolUse');
    expect(groupOf(out[0])).toBeNull();
  });

  it('keeps a toolResult without a matching toolUse standalone', () => {
    const blocks = [toolResult('t1')];
    const out = pairToolBlocks(blocks);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('toolResult');
  });

  it('pairs multiple toolUse/toolResult in order', () => {
    const blocks = [toolUse('t1'), toolUse('t2'), toolResult('t1'), toolResult('t2')];
    const out = pairToolBlocks(blocks);
    expect(out).toHaveLength(2);
    expect((out[0] as ToolBlockGroup).toolUse.id).toBe('t1');
    expect((out[1] as ToolBlockGroup).toolUse.id).toBe('t2');
  });

  it('preserves text blocks around tool groups', () => {
    const text: MessageBlock = { type: 'text', text: 'hello' };
    const blocks = [toolUse('t1'), toolResult('t1'), text];
    const out = pairToolBlocks(blocks);
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('tool');
    expect(out[1].type).toBe('text');
  });

  it('attaches a toolResult to the nearest preceding unmatched toolUse', () => {
    const blocks = [
      toolUse('t1'),
      toolUse('t2'),
      toolResult('t1'),
      toolResult('t2'),
      toolResult('t3'),
    ];
    const out = pairToolBlocks(blocks);
    // t1+t2 分别配对；t3 无对应 use，独立
    expect(out).toHaveLength(3);
    expect((out[0] as ToolBlockGroup).toolUse.id).toBe('t1');
    expect((out[1] as ToolBlockGroup).toolUse.id).toBe('t2');
    expect(out[2].type).toBe('toolResult');
  });

  it('handles an empty list', () => {
    expect(pairToolBlocks([])).toEqual([]);
  });
});
