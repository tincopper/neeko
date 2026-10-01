import { describe, expect, it } from 'vitest';

import type { PromptResource } from '@/shared/types/library';

import { filterPromptsByQuery, PROMPT_QUERY_LIMIT } from '../promptQuery';

function prompt(over: Partial<PromptResource> & { id: string }): PromptResource {
  return {
    name: `prompt-${over.id}`,
    description: null,
    content: `content-${over.id}`,
    slash: null,
    tags: [],
    scope: 'global',
    favorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: 1,
    updatedAt: 2,
    ...over,
  };
}

const REVIEW = prompt({
  id: 'p1',
  name: 'Review',
  description: 'Code Review Checklist',
  slash: 'review',
  tags: ['Git', 'backend'],
});

const PLAIN = prompt({ id: 'p2', name: 'Plain notes' });

describe('filterPromptsByQuery — prompt 匹配的唯一产出点', () => {
  it('空查询不过滤，仍截断到上限', () => {
    const many = Array.from({ length: PROMPT_QUERY_LIMIT + 5 }, (_, i) => prompt({ id: `x${i}` }));

    expect(filterPromptsByQuery(many, '')).toHaveLength(PROMPT_QUERY_LIMIT);
  });

  it('纯空白查询等同空查询（不按空格子串过滤）', () => {
    expect(filterPromptsByQuery([REVIEW, PLAIN], '   ')).toEqual([REVIEW, PLAIN]);
  });

  it('按 name / slash / description / tags 命中，且大小写无关', () => {
    for (const query of ['review', 'REVIEW', 'checklist', 'GIT', 'backend']) {
      expect(filterPromptsByQuery([REVIEW, PLAIN], query)).toEqual([REVIEW]);
    }
  });

  /**
   * `slash` 存的是裸词（UI 自己加 `/` 前缀展示），所以带斜杠的查询词匹配不到 ——
   * 这是抽取前后都成立的既有契约，此处钉住它，避免哪天被「顺手改成支持 /」悄悄改掉。
   */
  it('查询词带前导斜杠不匹配 slash 字段（存储值是裸词）', () => {
    expect(filterPromptsByQuery([REVIEW], '/review')).toEqual([]);
  });

  it('无命中返回空数组', () => {
    expect(filterPromptsByQuery([REVIEW, PLAIN], 'zzz')).toEqual([]);
  });

  it('slash/description 为 null 时不参与匹配也不抛错', () => {
    expect(() => filterPromptsByQuery([PLAIN], 'review')).not.toThrow();
    expect(filterPromptsByQuery([PLAIN], 'plain')).toEqual([PLAIN]);
  });

  it('不改动入参数组（渲染期禁止原地排序 store 缓存）', () => {
    const input = [REVIEW, PLAIN];
    const snapshot = [...input];

    filterPromptsByQuery(input, 'review');

    expect(input).toEqual(snapshot);
    expect(input).toHaveLength(2);
  });
});
