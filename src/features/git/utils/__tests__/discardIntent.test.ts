// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { FileChange } from '@/shared/types';

import {
  buildFileDiscardIntent,
  buildGroupDiscardIntent,
  describeDiscard,
  discardTargetPhrase,
  resolveDiscardPaths,
} from '../discardIntent';

function fc(path: string, unversioned = false): FileChange {
  return {
    path,
    status: unversioned ? 'Untracked' : 'Modified',
    additions: 0,
    deletions: 0,
    index_status: unversioned ? '?' : ' ',
    worktree_status: unversioned ? '?' : 'M',
  };
}

const TRACKED = [fc('a.ts'), fc('b.ts'), fc('c.ts')];

describe('resolveDiscardPaths — 组内选中优先', () => {
  it('无选中 → 整组', () => {
    expect(resolveDiscardPaths(TRACKED, new Set())).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('部分选中 → 只返回选中项（且保持组内顺序）', () => {
    expect(resolveDiscardPaths(TRACKED, new Set(['c.ts', 'a.ts']))).toEqual(['a.ts', 'c.ts']);
  });

  it('勾选了组外的路径不算本组选中（组内判定，非全局判定）', () => {
    expect(resolveDiscardPaths(TRACKED, new Set(['untracked.ts']))).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
    ]);
  });

  it('全选 → 等价于整组', () => {
    expect(resolveDiscardPaths(TRACKED, new Set(['a.ts', 'b.ts', 'c.ts']))).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
    ]);
  });
});

describe('buildGroupDiscardIntent — scope 由结果反推', () => {
  it('空组不产生意图', () => {
    expect(buildGroupDiscardIntent([], new Set(), 'tracked')).toBeNull();
  });

  it('选中数等于组大小 → scope=group', () => {
    expect(buildGroupDiscardIntent(TRACKED, new Set(['a.ts', 'b.ts', 'c.ts']), 'tracked')).toEqual({
      paths: ['a.ts', 'b.ts', 'c.ts'],
      scope: 'group',
      changeClass: 'tracked',
    });
  });

  it('部分选中 → scope=selection', () => {
    expect(buildGroupDiscardIntent(TRACKED, new Set(['b.ts']), 'tracked')).toEqual({
      paths: ['b.ts'],
      scope: 'selection',
      changeClass: 'tracked',
    });
  });

  it('无选中 → scope=group', () => {
    expect(buildGroupDiscardIntent(TRACKED, new Set(), 'unversioned')).toEqual({
      paths: ['a.ts', 'b.ts', 'c.ts'],
      scope: 'group',
      changeClass: 'unversioned',
    });
  });
});

describe('buildFileDiscardIntent — 单行', () => {
  it('scope=file 且带所在分组的类别', () => {
    expect(buildFileDiscardIntent('a.ts', 'unversioned')).toEqual({
      paths: ['a.ts'],
      scope: 'file',
      changeClass: 'unversioned',
    });
  });
});

describe('discardTargetPhrase — tooltip 与确认文案的单一出处', () => {
  it('file → 路径加引号', () => {
    expect(discardTargetPhrase(buildFileDiscardIntent('src/a.ts', 'tracked'))).toBe("'src/a.ts'");
  });

  it('selection → 「N 个选中」', () => {
    expect(
      discardTargetPhrase({ paths: ['a.ts'], scope: 'selection', changeClass: 'tracked' }),
    ).toBe('1 selected change');
    expect(
      discardTargetPhrase({ paths: ['a.ts', 'b.ts'], scope: 'selection', changeClass: 'tracked' }),
    ).toBe('2 selected changes');
  });

  it('group → 「全部 N 个」，类别决定名词', () => {
    expect(
      discardTargetPhrase({ paths: ['a.ts', 'b.ts'], scope: 'group', changeClass: 'tracked' }),
    ).toBe('all 2 changes');
    expect(
      discardTargetPhrase({ paths: ['a.ts'], scope: 'group', changeClass: 'unversioned' }),
    ).toBe('all 1 unversioned file');
  });
});

describe('describeDiscard — 确认文案随类别给出不同风险提示', () => {
  it('unversioned 明确告知不可恢复（git 里没有副本）', () => {
    const prompt = describeDiscard({
      paths: ['a.ts', 'b.ts'],
      scope: 'group',
      changeClass: 'unversioned',
    });

    expect(prompt.title).toBe('Discard all unversioned files?');
    expect(prompt.description).toContain('permanently deleted');
    expect(prompt.description).toContain('all 2 unversioned files');
    expect(prompt.confirmLabel).toBe('Discard All');
  });

  it('tracked 告知恢复到最近提交状态', () => {
    const prompt = describeDiscard({
      paths: ['a.ts'],
      scope: 'selection',
      changeClass: 'tracked',
    });

    expect(prompt.title).toBe('Discard selected changes?');
    expect(prompt.description).toContain('1 selected change');
    expect(prompt.description).toContain('restored to the last committed state');
    expect(prompt.confirmLabel).toBe('Discard');
  });

  it('文案中的数量与实际执行集合严格同源', () => {
    const intent = buildGroupDiscardIntent(TRACKED, new Set(['b.ts']), 'tracked');
    expect(intent).not.toBeNull();
    const { description } = describeDiscard(intent!);
    // 描述里的数字必须等于 paths.length —— 二次确认不得说谎
    expect(description).toContain(`${intent!.paths.length} selected change`);
  });
});
