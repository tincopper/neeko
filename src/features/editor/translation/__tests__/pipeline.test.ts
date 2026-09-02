import { describe, expect, it, vi } from 'vitest';

import type { SourceBlock } from '../blocks';
import { planBatchesAndTranslate, type TranslationTurn } from '../pipeline';

const block = (id: string, text: string): SourceBlock => ({ id, kind: 'paragraph', text });

/** 顺序脚本化 turn：每次 run 弹出一个结果（run 无参签名即可满足接口） */
function scriptedTurn(results: Array<{ text: string } | { error: Error }>): TranslationTurn {
  let call = 0;
  return {
    async run() {
      const step = results[call++];
      if (!step) throw new Error('unexpected extra turn');
      if ('error' in step) throw step.error;
      return step.text;
    },
  };
}

const translate = (
  blocks: SourceBlock[],
  results: Array<{ text: string } | { error: Error }>,
  opts?: { tokenBudget?: number; signal?: { aborted: boolean } },
) =>
  planBatchesAndTranslate(blocks, {
    targetLanguage: '简体中文',
    tokenBudget: opts?.tokenBudget ?? 1000,
    turn: scriptedTurn(results),
    signal: opts?.signal,
  });

describe('planBatchesAndTranslate — 批次调度', () => {
  it('顺序执行批次，译文按块 id 回填', async () => {
    const blocks = [block('b0', 'one'), block('b1', 'two')];
    const result = await translate(blocks, [{ text: '["一", "二"]' }]);

    expect(result.translations).toEqual({ b0: '一', b1: '二' });
    expect(result.failedIds).toEqual([]);
  });

  it('多批次顺序执行（token 预算切分）', async () => {
    const blocks = [block('b0', 'aaaa'), block('b1', 'bbbb'), block('b2', 'cccc')];
    // 预算 2 → 每批 2 块贪心 → 2 批
    const runs: string[] = [];
    const turn: TranslationTurn = {
      async run(prompt) {
        runs.push(prompt);
        return runs.length === 1 ? '["一","二"]' : '["三"]';
      },
    };
    const result = await planBatchesAndTranslate(blocks, {
      targetLanguage: '简体中文',
      tokenBudget: 2,
      turn,
    });

    expect(runs).toHaveLength(2);
    expect(result.translations).toEqual({ b0: '一', b1: '二', b2: '三' });
  });

  it('批次解析失败 → 该批块全部标记失败，后续批次继续', async () => {
    const blocks = [block('b0', 'one'), block('b1', 'two'), block('b2', 'three')];
    // 预算 2 → [b0,b1] 一批，b2 单独一批
    const result = await translate(
      blocks,
      [{ error: new Error('agent exploded') }, { text: '["三"]' }],
      { tokenBudget: 2 },
    );

    expect(result.translations).toEqual({ b2: '三' });
    expect(result.failedIds).toEqual(['b0', 'b1']);
  });

  it('单段译文为 null（模型漏段）→ 该段失败', async () => {
    const blocks = [block('b0', 'one'), block('b1', 'two')];
    const result = await translate(blocks, [{ text: '["一", null]' }]);

    expect(result.translations).toEqual({ b0: '一' });
    expect(result.failedIds).toEqual(['b1']);
  });

  it('批次间检测 abort → 剩余块保持未翻译，已译保留', async () => {
    const blocks = [block('b0', 'aaaa'), block('b1', 'bbbb'), block('b2', 'cccc')];
    const signal = { aborted: false };
    const result = await planBatchesAndTranslate(blocks, {
      targetLanguage: '简体中文',
      tokenBudget: 1, // 每块一批 → 3 批
      turn: {
        async run() {
          signal.aborted = true; // 第一批完成后中止
          return '["一"]';
        },
      },
      signal,
    });

    expect(result.translations).toEqual({ b0: '一' });
    expect(result.failedIds).toEqual([]);
    expect(result.aborted).toBe(true);
  });

  it('onBlockDone / onBlockFail 回调按批通知', async () => {
    const onBlockDone = vi.fn();
    const onBlockFail = vi.fn();
    const blocks = [block('b0', 'one'), block('b1', 'two')];
    await planBatchesAndTranslate(blocks, {
      targetLanguage: '简体中文',
      tokenBudget: 1000,
      turn: scriptedTurn([{ text: '["一", "二"]' }]),
      onBlockDone,
      onBlockFail,
    });

    expect(onBlockDone).toHaveBeenCalledWith({ b0: '一', b1: '二' });
    expect(onBlockFail).not.toHaveBeenCalled();
  });
});
