import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { flushMicrotasks } from '@/testing/async';

import type * as navigateCaretModule from '../../navigateCaret';
import { applyNavigateCaret, navigateCaretExtension } from '../../navigateCaret';
import { useNavigateGoal } from '../useNavigateGoal';

// applyNavigateCaret 包一层可观察的 vi.fn（默认透传真实实现）：
// 「恰好一次 / 旧 seq 不生效」的可观察面就是 delegate 的调用次数与实参。
vi.mock('../../navigateCaret', async (importOriginal) => {
  const actual = await importOriginal<typeof navigateCaretModule>();
  return {
    ...actual,
    applyNavigateCaret: vi.fn(actual.applyNavigateCaret),
  };
});

const DOC = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');

// 可控 rAF：CM6 的 requestMeasure 经 view.win.requestAnimationFrame 调度测量，
// write 阶段在测量完成后执行。jsdom 无真实帧，手动 flush（惯例同 AgentChatTabView 测试）。
let rafCallbacks: Array<() => void> = [];
const rafStub = vi.fn((cb: FrameRequestCallback) => {
  rafCallbacks.push(() => cb(0));
  return rafCallbacks.length;
});
const rafCancelStub = vi.fn();

/** 冲刷所有已排队（含嵌套调度）的动画帧。 */
function flushRaf() {
  for (let i = 0; i < 4 && rafCallbacks.length > 0; i++) {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    for (const cb of cbs) cb();
  }
}

/**
 * 跑完一个完整测量周期：rAF → measure → write（武装兑现）→ 兑现微任务。
 * write 阶段禁止 dispatch，兑现被推迟到 measure 返回后的微任务 —— 断言前必须冲刷。
 */
async function runMeasureCycle() {
  await act(async () => {
    flushRaf();
    await flushMicrotasks();
  });
}

function makeView(doc = DOC): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({ doc, extensions: [navigateCaretExtension] }),
    parent,
  });
}

/** 光标当前所在行（1-based）。 */
function caretLine(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

/** 写入一条用户意图导航目标，返回其 seq。 */
function setGoal(tabKey: string, tabId: string, line: number, col = 0): number {
  act(() => {
    useEditorStore.getState().setNavigateGoal({ tabKey, tabId, line, col });
  });
  return useEditorStore.getState().navigateGoal!.seq;
}

/**
 * 挂载兑现器。ref 在外部持有（视图可后置attach，覆盖「goal 写入时无视图」的窗口）；
 * epoch 可变（覆盖视图重建重放）。
 */
function renderGoal(view: EditorView | null, epoch = 0) {
  const ref: { current: EditorView | null } = { current: view };
  const harness = renderHook(
    ({ e }: { e: number }) =>
      useNavigateGoal({ tabKey: 'k1', tabId: 't1', editorViewRef: ref, viewEpoch: e }),
    { initialProps: { e: epoch } },
  );
  return { ...harness, ref };
}

describe('useNavigateGoal — 用户意图导航目标兑现器（目标状态模型）', () => {
  beforeEach(() => {
    rafCallbacks = [];
    rafStub.mockClear();
    rafCancelStub.mockClear();
    // CM6 的 requestMeasure 经 view.win.requestAnimationFrame 调度；vitest jsdom 下
    // document.defaultView === globalThis，stubGlobal 一处即可（勿再 spyOn 同一对象，
    // 两者叠加会自包裹递归）。
    vi.stubGlobal('requestAnimationFrame', rafStub);
    vi.stubGlobal('cancelAnimationFrame', rafCancelStub);
    vi.mocked(applyNavigateCaret).mockClear();
    useEditorStore.setState({ navigateGoal: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[G1] consumes the goal on view create: caret lands on the goal line and the goal is cleared', async () => {
    const view = makeView();
    setGoal('k1', 't1', 10);
    const { result } = renderGoal(view);

    let consumed = false;
    act(() => {
      consumed = result.current.consumeOnViewCreate();
    });
    await runMeasureCycle();

    expect(consumed).toBe(true);
    expect(caretLine(view)).toBe(10);
    expect(useEditorStore.getState().navigateGoal).toBeNull();
  });

  it('[G1] consumeOnViewCreate returns false for a foreign-tab goal: no apply, goal retained', async () => {
    const view = makeView();
    setGoal('k1', 'OTHER', 10);
    const { result } = renderGoal(view);

    let consumed: boolean | undefined;
    act(() => {
      consumed = result.current.consumeOnViewCreate();
    });
    await runMeasureCycle();

    expect(consumed).toBe(false);
    expect(caretLine(view)).toBe(1);
    expect(useEditorStore.getState().navigateGoal).not.toBeNull();
  });

  it('[G2] a goal written while no view exists survives and is redeemed on view create (I1)', async () => {
    // 视图缺失时挂载：订阅回调必须跳过（view null），目标滞留待兑现。
    const { result, ref } = renderGoal(null);

    setGoal('k1', 't1', 12);
    expect(useEditorStore.getState().navigateGoal).not.toBeNull();

    ref.current = makeView();
    let consumed = false;
    act(() => {
      consumed = result.current.consumeOnViewCreate();
    });
    await runMeasureCycle();

    expect(consumed).toBe(true);
    expect(caretLine(ref.current!)).toBe(12);
    expect(useEditorStore.getState().navigateGoal).toBeNull();
  });

  it('[G2] goal scheduled on a view destroyed before its write is redeemed by the rebuilt view (self-heal)', async () => {
    const view1 = makeView();
    const { result, rerender, ref } = renderGoal(view1);
    setGoal('k1', 't1', 14);

    // StrictMode 重挂载窗口：兑现已调度，但视图在 write 执行前被销毁。
    act(() => {
      result.current.consumeOnViewCreate();
    });
    view1.destroy();
    ref.current = makeView();
    act(() => {
      rerender({ e: 1 });
    });
    await runMeasureCycle();

    // 旧视图未兑现 → 目标不丢 → 由重建视图兑现（与停点跟随同一自愈纪律）。
    expect(caretLine(ref.current!)).toBe(14);
    expect(useEditorStore.getState().navigateGoal).toBeNull();
  });

  it('[G3] a second consumption after the goal was redeemed is a no-op (I2: exactly once)', async () => {
    const view = makeView();
    setGoal('k1', 't1', 10);
    const { result } = renderGoal(view);

    act(() => {
      result.current.consumeOnViewCreate();
    });
    await runMeasureCycle();
    expect(useEditorStore.getState().navigateGoal).toBeNull();

    let second = true;
    act(() => {
      second = result.current.consumeOnViewCreate();
    });
    await runMeasureCycle();

    expect(second).toBe(false);
    expect(vi.mocked(applyNavigateCaret)).toHaveBeenCalledTimes(1);
    expect(caretLine(view)).toBe(10);
  });

  it('[G3] applyNavigateCaret failure still clears the goal (no stale intent retention)', async () => {
    const view = makeView();
    setGoal('k1', 't1', 10);
    const { result } = renderGoal(view);
    vi.mocked(applyNavigateCaret).mockImplementationOnce(() => false);

    act(() => {
      result.current.consumeOnViewCreate();
    });
    await runMeasureCycle();

    expect(useEditorStore.getState().navigateGoal).toBeNull();
  });

  it('[G4] a newer goal supersedes an older one: stale scheduled write neither applies nor clears the new goal (I3)', async () => {
    const view = makeView();
    setGoal('k1', 't1', 10);
    const { result } = renderGoal(view);

    // 旧 seq 的 write 已调度；flush 前新意图写入（取代旧目标）。
    act(() => {
      result.current.consumeOnViewCreate();
    });
    setGoal('k1', 't1', 20);
    await runMeasureCycle();

    // 旧 seq 的 write 不生效（delegate 仅新目标一次调用）；新目标兑现后被清除。
    expect(vi.mocked(applyNavigateCaret)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyNavigateCaret)).toHaveBeenCalledWith(view, 20, 0);
    expect(caretLine(view)).toBe(20);
    expect(useEditorStore.getState().navigateGoal).toBeNull();
  });

  it('[G4] clearNavigateGoal(seq) only clears when the current goal is that seq (store-level currency)', () => {
    const seq1 = setGoal('k1', 't1', 10);
    const seq2 = setGoal('k1', 't1', 20);
    expect(seq2).toBeGreaterThan(seq1);

    // 旧 seq 的迟到清除不得吞掉新目标。
    act(() => {
      useEditorStore.getState().clearNavigateGoal(seq1);
    });
    expect(useEditorStore.getState().navigateGoal?.seq).toBe(seq2);

    // 当前 seq 匹配才清。
    act(() => {
      useEditorStore.getState().clearNavigateGoal(seq2);
    });
    expect(useEditorStore.getState().navigateGoal).toBeNull();
  });

  it('[G5] the goal is applied via view.requestMeasure write (readiness barrier), not a bare rAF guess', () => {
    const view = makeView();
    const spy = vi.spyOn(view, 'requestMeasure');
    setGoal('k1', 't1', 10);
    const { result } = renderGoal(view);

    act(() => {
      result.current.consumeOnViewCreate();
    });

    // 调度方式断言：兑现经 CM 原生 requestMeasure（write 在测量完成后执行）。
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ write: expect.any(Function) }));
  });

  it('subscription applies a goal written after the view already exists (existing-tab path)', async () => {
    const view = makeView();
    const { result } = renderGoal(view);

    // 视图已挂载时才写入目标（quick-open / 链接点击复用既有 tab 的路径）：
    // 无需 consumeOnViewCreate，订阅路径直接兑现。
    setGoal('k1', 't1', 18);
    await runMeasureCycle();

    expect(caretLine(view)).toBe(18);
    expect(useEditorStore.getState().navigateGoal).toBeNull();
    void result;
  });

  it('[I2] two mounted instances (split pane) consuming the same goal apply exactly once', async () => {
    // 同一 tabId 在多 pane 挂载多份 FileEditor（useDebugStopReveal 注释提过的场景）：
    // 两个实例都订阅同一 store，各自调度兑现 —— seq 货币性保证恰好一个视图兑现，
    // 另一个的迟到兑现不重放、也不误清（已清）目标。
    const viewA = makeView();
    const viewB = makeView();
    renderGoal(viewA);
    renderGoal(viewB);

    setGoal('k1', 't1', 10);
    await runMeasureCycle();

    expect(vi.mocked(applyNavigateCaret)).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().navigateGoal).toBeNull();
    const applied = caretLine(viewA) === 10 ? viewA : viewB;
    expect(caretLine(applied)).toBe(10);
    // 未兑现的实例停在原位，不重复跳转。
    expect(caretLine(applied === viewA ? viewB : viewA)).toBe(1);
  });
});
