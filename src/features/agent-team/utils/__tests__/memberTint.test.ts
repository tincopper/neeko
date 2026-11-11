import { describe, expect, it } from 'vitest';

import { MEMBER_TINT_TONES, memberInitial, memberTint } from '../memberTint';

/**
 * 头像色的**稳定性**判据。
 *
 * 这里的每一条都在防同一类事故：颜色是记忆线索，**错位比没有更糟**（错位后的颜色看起来
 * 仍然「有意义」，用户会认错人）。所以取色只允许依赖 `memberId`。
 */
describe('memberTint — 按 memberId 派生', () => {
  it('同一个 id 恒同色（调用顺序、次数都不影响）', () => {
    const ids = ['lead@tm_1', 'w1@tm_1', 'w2@tm_1', 'researcher@tm_9'];
    const first = ids.map((id) => memberTint(id));
    // 倒序再算一次：结果必须与 id 一一对应，而不是与调用顺序对应
    const reversed = [...ids].reverse().map((id) => memberTint(id));
    expect([...reversed].reverse()).toEqual(first);
  });

  it('重排后每个 id 的颜色不变（列表顺序不是输入）', () => {
    const ids = ['a@tm_1', 'b@tm_1', 'c@tm_1', 'd@tm_1', 'e@tm_1'];
    const before = new Map(ids.map((id) => [id, memberTint(id)]));
    const shuffled = ['c@tm_1', 'e@tm_1', 'a@tm_1', 'd@tm_1', 'b@tm_1'];
    for (const id of shuffled) {
      expect(memberTint(id)).toBe(before.get(id));
    }
  });

  it('只从调色板里取色（主题里没有的颜色不许出现）', () => {
    for (const id of ['', 'w1', 'w2', 'w3', '名字', 'x'.repeat(64)]) {
      expect(MEMBER_TINT_TONES).toContain(memberTint(id));
    }
  });

  it('相邻 id 不会退化成「按顺序分配」（哈希要散开）', () => {
    const tints = ['w1@tm_1', 'w2@tm_1', 'w3@tm_1', 'w4@tm_1'].map((id) => memberTint(id));
    // 全都一样说明取模退化（颜色=装饰），全都依次递增说明是按顺序分（加人即错位）
    expect(new Set(tints).size).toBeGreaterThan(1);
    expect(tints).not.toEqual([...MEMBER_TINT_TONES.slice(0, 4)]);
  });
});

describe('memberInitial — 首字母', () => {
  it('取第一个码点并大写', () => {
    expect(memberInitial('frontend')).toBe('F');
    expect(memberInitial('  backend ')).toBe('B');
  });

  it('CJK 名字取第一个字（不切出半个字符）', () => {
    expect(memberInitial('前端')).toBe('前');
  });

  it('代理对（emoji）不被切断', () => {
    expect(memberInitial('🚀rocket')).toBe('🚀');
  });

  it('空名字有明确兜底（不是一个空格）', () => {
    expect(memberInitial('   ')).toBe('?');
  });
});
