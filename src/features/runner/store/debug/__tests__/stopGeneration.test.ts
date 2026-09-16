import { beforeEach, describe, expect, it } from 'vitest';

import {
  isSameGeneration,
  nextGeneration,
  resetGenerationSeqForTest,
  stopContextUnchanged,
  type StopGeneration,
} from '../stopGeneration';

beforeEach(() => {
  resetGenerationSeqForTest();
});

describe('nextGeneration — 代际单调递增', () => {
  it('should_return_strictly_increasing_seq_within_a_session', () => {
    const first = nextGeneration('s1');
    const second = nextGeneration('s1');

    expect(second.seq).toBeGreaterThan(first.seq);
  });

  it('should_keep_increasing_across_sessions', () => {
    // 全局单调：seq 不做排序语义，但要保证任意两次取号不相等（会话 id 参与相等判定）。
    const a = nextGeneration('s1');
    const b = nextGeneration('s2');

    expect(b.seq).not.toBe(a.seq);
    expect(a.sessionId).toBe('s1');
    expect(b.sessionId).toBe('s2');
  });

  it('should_carry_the_session_id_verbatim', () => {
    expect(nextGeneration('s7').sessionId).toBe('s7');
  });
});

describe('isSameGeneration — 相等判定（只判等，不比较大小）', () => {
  it('should_be_true_for_equal_session_and_seq', () => {
    const gen: StopGeneration = { sessionId: 's1', seq: 3 };
    expect(isSameGeneration(gen, { sessionId: 's1', seq: 3 })).toBe(true);
  });

  it('should_be_false_when_seq_differs', () => {
    expect(isSameGeneration({ sessionId: 's1', seq: 3 }, { sessionId: 's1', seq: 4 })).toBe(false);
  });

  it('should_be_false_when_session_differs', () => {
    expect(isSameGeneration({ sessionId: 's1', seq: 3 }, { sessionId: 's2', seq: 3 })).toBe(false);
  });

  it('should_be_false_when_either_side_is_null', () => {
    // 关键：会话结束 / 复位后 store 的 generation 为 null，在途旧链必须被判定为「非当前」。
    const gen: StopGeneration = { sessionId: 's1', seq: 3 };
    expect(isSameGeneration(null, gen)).toBe(false);
    expect(isSameGeneration(gen, null)).toBe(false);
    expect(isSameGeneration(null, null)).toBe(false);
    expect(isSameGeneration(undefined, gen)).toBe(false);
  });
});

describe('stopContextUnchanged — 切帧的「捕获一次、await 后复查」判据', () => {
  const gen: StopGeneration = { sessionId: 's1', seq: 3 };

  it('should_be_true_when_both_sides_have_no_generation（未经过 beginStop 的停止态）', () => {
    // 关键：与 isSameGeneration(null, null)===false 的差异所在 —— 切帧不 beginStop，
    // 「捕获时无代际、复查时仍无代际」= 什么都没发生，必须继续（否则静默不写变量 / 不打开源码 tab）。
    expect(stopContextUnchanged(null, null)).toBe(true);
    expect(isSameGeneration(null, null)).toBe(false);
  });

  it('should_be_false_when_only_one_side_has_a_generation', () => {
    expect(stopContextUnchanged(gen, null)).toBe(false);
    expect(stopContextUnchanged(null, gen)).toBe(false);
  });

  it('should_be_true_for_the_same_generation_and_false_for_a_newer_one', () => {
    expect(stopContextUnchanged({ sessionId: 's1', seq: 3 }, gen)).toBe(true);
    expect(stopContextUnchanged({ sessionId: 's1', seq: 4 }, gen)).toBe(false);
    expect(stopContextUnchanged({ sessionId: 's2', seq: 3 }, gen)).toBe(false);
  });
});

describe('resetGenerationSeqForTest — 用例独立', () => {
  it('should_restart_the_counter_so_tests_do_not_depend_on_order', () => {
    const before = nextGeneration('s1');
    resetGenerationSeqForTest();

    expect(nextGeneration('s1')).toEqual(before);
  });
});
