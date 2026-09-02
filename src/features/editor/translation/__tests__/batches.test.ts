import { describe, expect, it } from 'vitest';

import { estimateTokens, planTranslationBatches } from '../batches';
import type { SourceBlock } from '../blocks';

const block = (id: string, text: string): SourceBlock => ({
  id,
  kind: 'paragraph',
  text,
});

describe('estimateTokens — 粗略 token 估算', () => {
  it('拉丁文本约 4 字符 = 1 token', () => {
    // 12 个拉丁字符（不含空格计权差异，用公式验证）
    expect(estimateTokens('abcdefghij')).toBe(Math.ceil(10 / 4));
  });

  it('CJK 字符每字约 1 token', () => {
    expect(estimateTokens('四个汉字')).toBe(4);
  });

  it('混排文本 = CJK 计数 + 非CJK 字符/4', () => {
    // 2 CJK + 8 latin → 2 + ceil(8/4)
    expect(estimateTokens('两个english')).toBe(2 + Math.ceil(7 / 4));
  });

  it('空文本 → 0', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('planTranslationBatches — token 预算凑批', () => {
  it('空块序列 → 无批次', () => {
    expect(planTranslationBatches([], 100)).toEqual([]);
  });

  it('预算充足 → 单批包含全部块（保持文档序）', () => {
    const blocks = [block('b0', 'one'), block('b1', 'two'), block('b2', 'three')];
    expect(planTranslationBatches(blocks, 1000)).toEqual([blocks]);
  });

  it('超预算 → 相邻贪心凑批', () => {
    const blocks = [block('b0', 'aaaa'), block('b1', 'bbbb'), block('b2', 'cccc')];
    // 每块 1 token，预算 2 → [b0,b1], [b2]
    const result = planTranslationBatches(blocks, 2);
    expect(result).toEqual([blocks.slice(0, 2), blocks.slice(2)]);
  });

  it('单块超过预算 → 独立成批（不拆分、不丢弃）', () => {
    const huge = block('b1', 'x'.repeat(100)); // 25 tokens
    const blocks = [block('b0', 'a'), huge, block('b2', 'c')];
    const result = planTranslationBatches(blocks, 10);
    expect(result).toEqual([[blocks[0]], [huge], [blocks[2]]]);
  });

  it('预算边界：恰好等于预算 → 同批', () => {
    const blocks = [block('b0', 'ab')]; // 1 token
    expect(planTranslationBatches(blocks, 1)).toEqual([blocks]);
  });

  it('零/负预算 → 每块独立成批（退化为逐段翻译）', () => {
    const blocks = [block('b0', 'a'), block('b1', 'b')];
    expect(planTranslationBatches(blocks, 0)).toEqual([[blocks[0]], [blocks[1]]]);
    expect(planTranslationBatches(blocks, -5)).toEqual([[blocks[0]], [blocks[1]]]);
  });
});
