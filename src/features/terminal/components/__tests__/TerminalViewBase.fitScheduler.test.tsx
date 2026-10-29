// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CacheEntry, TerminalStrategy } from '../../strategies/types';

/**
 * fit 调度器归属回归（根因：PTY 不同步 → 切 tab 后终端格式混乱）。
 *
 * 旧实现的去重基线（lastFitCols/rows + pending）挂在组件级 useRef 上，
 * 跨 cacheKey 存活：tab A 已同步到 (100,30) → 切到 tab B，B 首次 fit 得到同尺寸
 * (100,30) → 撞上 lastFit 早退闸 → resize_terminal 不发 → PTY 停在上一个网格 →
 * agent/vim 按旧网格重绘，格式混乱，直到拖动 panel 使本地尺寸真变才自愈。
 *
 * 不变式：调度器实例按 cacheKey 归属（attach 新建 / cleanup dispose），
 * 新实例的去重基线必须为空 → 首次 fit 必同步一次。
 *
 * 关键：必须用 **rerender 同一组件实例** 才能复现。两次 render() 是两个组件
 * 实例、各有全新 refs，反而绕开了这个 bug —— 真实 app 是同一个 TerminalViewBase
 * 常驻，cacheKey 变而已。
 */

const resizeMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

/** 每个 cacheKey 一个独立 entry（模拟真实的多 tab cache）。 */
function makeEntry(cols = 80, rows = 24): CacheEntry {
  const term = {
    cols,
    rows,
    options: {} as Record<string, unknown>,
    onScroll: vi.fn(() => ({ dispose: vi.fn() })),
    write: vi.fn((_d: unknown, cb?: () => void) => cb?.()),
    focus: vi.fn(),
    scrollToBottom: vi.fn(),
    buffer: { active: { viewportY: 0, baseY: 0 } },
  };
  const fitAddon = {
    // 模拟「fit 收敛」：wrapper 尺寸没变时本地网格不变（tab 切回的典型情形）
    fit: vi.fn(),
  };
  return {
    term: term as unknown as CacheEntry['term'],
    fitAddon: fitAddon as unknown as CacheEntry['fitAddon'],
    element: document.createElement('div'),
    sessionId: 'session-1',
    unlisten: null,
    inputController: null,
  };
}

function makeStrategy(cache: Map<string, CacheEntry>, cacheKey: string): TerminalStrategy {
  return {
    kind: 'local',
    cacheKey,
    cache,
    rebuildCallbacks: new Map(),
    wrapperRefs: new Map(),
    createSession: vi.fn().mockResolvedValue('session-1'),
    resize: resizeMock,
    closeSession: vi.fn().mockResolvedValue(undefined),
    agentDelayMs: 0,
    fontSize: 13,
    fontFamily: 'Mono',
    gpuAccel: false,
  };
}

describe('TerminalViewBase fit 调度器归属', () => {
  beforeEach(() => {
    resizeMock.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cacheKey 切换后新终端的首次 fit 仍同步到 PTY（不继承上一终端的同步历史）', async () => {
    // 两个 tab 同尺寸并存 —— 旧实现在此把 B 的首次同步整个丢掉
    const entryA = makeEntry(100, 30);
    const entryB = makeEntry(100, 30);
    const cache = new Map<string, CacheEntry>([
      ['keyA', entryA],
      ['keyB', entryB],
    ]);

    vi.doMock('@/shared/utils/terminal', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/shared/utils/terminal')>()),
      applyRenderer: vi.fn().mockResolvedValue(undefined),
      resumeWebglRenderer: vi.fn().mockResolvedValue(undefined),
      suspendWebglRenderer: vi.fn(),
      healWebglRenderer: vi.fn(),
      safeDisposeTerminal: vi.fn(),
    }));

    const { default: TerminalViewBase } = await import('../TerminalViewBase');
    const strategyA = makeStrategy(cache, 'keyA');
    const strategyB = makeStrategy(cache, 'keyB');

    // tab A 挂载 → fit → resize(100,30)
    const view = render(
      <TerminalViewBase strategy={strategyA} tabAgentId={null} activeTabId="tA" />,
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(resizeMock).toHaveBeenCalledWith('session-1', 100, 30);
    resizeMock.mockClear();

    // 壳层几何：**只留左侧内边**。终端的滚动条由 xterm 自绘（overlay，贴在
    // xterm 元素的右边缘），给壳层加右内边会把滚动条一起从右边缘推进去 ——
    // 2026-11 实测后回退 px-2。网格右侧的余量（<1 字宽）是字符网格固有的。
    // eslint-disable-next-line testing-library/no-node-access -- 结构断言：xterm 宿主容器类名
    const wrapper = document.querySelector('.terminal-wrapper');
    expect(wrapper).toHaveClass('pl-2');
    expect(wrapper).not.toHaveClass('pr-2');
    expect(wrapper).not.toHaveClass('px-2');

    // 切到 tab B：同一个组件实例，cacheKey 变（真实 app 的切换形态）
    view.rerender(<TerminalViewBase strategy={strategyB} tabAgentId={null} activeTabId="tB" />);
    await vi.advanceTimersByTimeAsync(200);

    // B 的 entry.sessionId 也等于 'session-1'（独立会话但同 id 便于断言）。
    // 旧实现中这次 resize 被 lastFit 早退闸吃掉 → 0 次。
    expect(resizeMock).toHaveBeenCalledTimes(1);
    expect(resizeMock).toHaveBeenCalledWith('session-1', 100, 30);
  });

  // 效果顺序守卫（覆盖率有限，如实注明）：jsdom 的 RO 在 attach 后会自发一次通知，
  // 掩盖「字体同步跑在调度器创建之前」这一缺陷的 fit 缺失，故它无法机器证伪该顺序错误。
  // 此处断言的是根因修复的两条路径：B 的 fit 真实发生 + PTY 同步补发。顺序约束本身靠
  // syncFont 上方注释 + effect 内联（而非独立前置 effect）保证，不把测试写成假覆盖。
  it('cacheKey 切换时 fit 发生 + PTY 同步补发（守卫覆盖 fit + PTY 两条路径）', async () => {
    const entryA = makeEntry(100, 30);
    const entryB = makeEntry(100, 30);
    const cache = new Map<string, CacheEntry>([
      ['keyA', entryA],
      ['keyB', entryB],
    ]);

    vi.doMock('@/shared/utils/terminal', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/shared/utils/terminal')>()),
      applyRenderer: vi.fn().mockResolvedValue(undefined),
      resumeWebglRenderer: vi.fn().mockResolvedValue(undefined),
      suspendWebglRenderer: vi.fn(),
      healWebglRenderer: vi.fn(),
      safeDisposeTerminal: vi.fn(),
    }));

    const { default: TerminalViewBase } = await import('../TerminalViewBase');
    const view = render(
      <TerminalViewBase
        strategy={makeStrategy(cache, 'keyA')}
        tabAgentId={null}
        activeTabId="tA"
      />,
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(resizeMock).toHaveBeenCalledWith('session-1', 100, 30);
    resizeMock.mockClear();
    entryA.fitAddon.fit.mockClear();
    entryB.fitAddon.fit.mockClear();

    // cacheKey 切换：全部 effect 重跑。若字体同步跑在调度器创建之前，它的 fit 会丢。
    view.rerender(
      <TerminalViewBase
        strategy={makeStrategy(cache, 'keyB')}
        tabAgentId={null}
        activeTabId="tB"
      />,
    );
    await vi.advanceTimersByTimeAsync(200);

    // B 的 fit 必须发生过（效果顺序正确时 syncFont + attach + RO 至少触发一次）
    expect(entryB.fitAddon.fit).toHaveBeenCalled();
    // 且 PTY 同步补发（去重基线已随新调度器重置）
    expect(resizeMock).toHaveBeenCalledWith('session-1', 100, 30);
  });
});
