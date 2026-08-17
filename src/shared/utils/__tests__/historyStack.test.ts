import { describe, expect, it } from 'vitest';

import { canGoBack, canGoForward, createHistoryStack, recordNavigation } from '../historyStack';

describe('createHistoryStack', () => {
  it('creates an empty stack with index -1', () => {
    const s = createHistoryStack();
    expect(s.entries).toEqual([]);
    expect(s.index).toBe(-1);
    expect(canGoBack(s)).toBe(false);
    expect(canGoForward(s)).toBe(false);
  });

  it('creates a stack rooted at the initial URL', () => {
    const s = createHistoryStack('https://a.com');
    expect(s.entries).toEqual(['https://a.com']);
    expect(s.index).toBe(0);
  });
});

describe('recordNavigation — forward navigation', () => {
  it('records the first URL on an empty stack', () => {
    const s = recordNavigation(createHistoryStack(), 'https://a.com');
    expect(s.entries).toEqual(['https://a.com']);
    expect(s.index).toBe(0);
  });

  it('appends new URLs in order', () => {
    let s = createHistoryStack('https://a.com');
    s = recordNavigation(s, 'https://b.com');
    s = recordNavigation(s, 'https://c.com');
    expect(s.entries).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    expect(s.index).toBe(2);
  });

  it('truncates the forward branch when navigating from a middle entry', () => {
    // A → B → C, 然后后退到 B,再从 B 导航到 D
    let s = createHistoryStack('https://a.com');
    s = recordNavigation(s, 'https://b.com');
    s = recordNavigation(s, 'https://c.com');
    s = recordNavigation(s, 'https://b.com'); // 命中历史 → 指针回 B
    s = recordNavigation(s, 'https://d.com'); // 新导航 → 截断 C

    expect(s.entries).toEqual(['https://a.com', 'https://b.com', 'https://d.com']);
    expect(s.index).toBe(2);
    expect(canGoForward(s)).toBe(false);
  });

  it('ignores same-URL refresh/redirect', () => {
    const s = createHistoryStack('https://a.com');
    const after = recordNavigation(s, 'https://a.com');
    expect(after).toBe(s); // 引用不变
  });
});

describe('recordNavigation — back/forward', () => {
  it('moves the pointer back when url-changed fires for a historical entry', () => {
    let s = createHistoryStack('https://a.com');
    s = recordNavigation(s, 'https://b.com');
    s = recordNavigation(s, 'https://c.com');

    // 后退到 B(url-changed 上报 B)
    s = recordNavigation(s, 'https://b.com');
    expect(s.index).toBe(1);
    expect(canGoBack(s)).toBe(true);
    expect(canGoForward(s)).toBe(true);

    // 再后退到 A
    s = recordNavigation(s, 'https://a.com');
    expect(s.index).toBe(0);
    expect(canGoBack(s)).toBe(false);
    expect(canGoForward(s)).toBe(true);
  });

  it('moves the pointer forward when url-changed fires for a forward entry', () => {
    let s = createHistoryStack('https://a.com');
    s = recordNavigation(s, 'https://b.com');
    s = recordNavigation(s, 'https://c.com');
    s = recordNavigation(s, 'https://a.com'); // 回 A
    s = recordNavigation(s, 'https://b.com'); // 前进到 B

    expect(s.index).toBe(1);
  });
});

describe('canGoBack / canGoForward', () => {
  it('reports correct states at each position', () => {
    let s = createHistoryStack('https://a.com');
    expect(canGoBack(s)).toBe(false);
    expect(canGoForward(s)).toBe(false);

    s = recordNavigation(s, 'https://b.com');
    expect(canGoBack(s)).toBe(true);
    expect(canGoForward(s)).toBe(false);

    s = recordNavigation(s, 'https://a.com'); // 回 A
    expect(canGoBack(s)).toBe(false);
    expect(canGoForward(s)).toBe(true);
  });

  it('is per-stack independent (project isolation)', () => {
    const s1 = createHistoryStack('https://p1.com');
    const s2 = createHistoryStack('https://p2.com');
    const s1After = recordNavigation(s1, 'https://p1.com/b');

    expect(s1After.entries).toEqual(['https://p1.com', 'https://p1.com/b']);
    // s2 不受 s1 导航影响
    expect(s2.entries).toEqual(['https://p2.com']);
    expect(s2.index).toBe(0);
    expect(s2.entries).not.toContain('https://p1.com/b');
  });

  it('残缺/undefined 栈防御：不崩溃、视为不可前进后退', () => {
    // 回归：残缺 panel 状态（缺 history）曾导致
    // canGoBack(undefined) → "undefined is not an object (stack.index)" 应用崩溃。
    expect(canGoBack(undefined as never)).toBe(false);
    expect(canGoForward(undefined as never)).toBe(false);
    expect(recordNavigation(undefined as never, 'https://a.com')).toEqual({
      entries: ['https://a.com'],
      index: 0,
    });
  });
});
