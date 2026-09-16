import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDebugStore } from '@/features/runner/store/debugStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { DapSessionInfo } from '@/shared/types';

import { flashNavLineField, navigateCaretExtension } from '../../navigateCaret';
import { resetOutOfRangeWarnForTests, useDebugStopReveal } from '../useDebugStopReveal';

const A = '/repo/src/A.java';
const B = '/repo/src/B.java';
const DOC = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');

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

function sessionWith(status: string): DapSessionInfo {
  return {
    sessionId: 's1',
    projectId: 'p1',
    projectPath: '/repo',
    configName: 'cfg',
    status,
  };
}

/** 一次停点：位置 + 严格单调的序号（序号是编辑器侧的「事件键」）。 */
function seedStop(identity: string, line: number, seq = 1, status = 'stopped'): void {
  useDebugStore.setState({
    session: sessionWith(status),
    location: { identity, line, column: 0 },
    locationSeq: seq,
  });
}

function clearStop(seq = 2, status = 'terminated'): void {
  useDebugStore.setState({ session: sessionWith(status), location: null, locationSeq: seq });
}

function renderReveal(
  view: EditorView,
  filePath: string,
  epoch = 0,
): ReturnType<typeof renderHook<undefined, { e: number }>> {
  const ref = { current: view };
  return renderHook(
    ({ e }: { e: number }) =>
      useDebugStopReveal({
        absFilePath: filePath,
        tabFilePath: filePath,
        editorViewRef: ref,
        viewEpoch: e,
      }),
    { initialProps: { e: epoch } },
  );
}

function moveCaret(view: EditorView, line: number): void {
  act(() => {
    view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
  });
}

/** 被标记为「导航闪烁」的行（1-based）——用来断言「未发生任何放置」。 */
function flashLines(view: EditorView): number[] {
  const out: number[] = [];
  const iter = view.state.field(flashNavLineField).iter();
  while (iter.value) {
    out.push(view.state.doc.lineAt(iter.from).number);
    iter.next();
  }
  return out;
}

beforeEach(() => {
  resetOutOfRangeWarnForTests(); // 越界告警去重是模块级记忆，用例之间必须隔离
  useDebugStore.setState({ session: null, location: null, locationSeq: 0, generation: null });
  useProjectStore.setState({
    activeProjectId: 'p1',
    activeProject: { id: 'p1', path: '/repo' } as never,
  });
});

describe('useDebugStopReveal — 停点跟随（派生 + 幂等重放）', () => {
  it('[T6] 停点落在本文件 → 光标移动到停止行', () => {
    const view = makeView();
    seedStop(A, 10);

    renderReveal(view, A);

    expect(caretLine(view)).toBe(10);
    view.destroy();
  });

  it('[T7] 同一序号的重放仍收敛到停止行，且不重复记录原光标位置', () => {
    const view = makeView();
    seedStop(A, 10, 1);
    const { rerender } = renderReveal(view, A);
    expect(caretLine(view)).toBe(10);

    // 视图重建 / 切回 tab：仅 viewEpoch 变化（序号不变）→ 幂等重放
    rerender({ e: 1 });
    expect(caretLine(view)).toBe(10);
    expect(flashLines(view)).toEqual([10]);

    // 重放若重复记录「调试前光标位置」，释放时就会停在放置行而不是用户原位置
    clearStop(2);
    rerender({ e: 2 });
    expect(view.state.selection.main.head).toBe(0);
    view.destroy();
  });

  it('[T8] 用户挪走光标后同一序号不再夺回；新序号恢复跟随', () => {
    const view = makeView();
    seedStop(A, 10, 1);
    const { rerender } = renderReveal(view, A);
    expect(caretLine(view)).toBe(10);

    moveCaret(view, 3);
    rerender({ e: 1 });
    expect(caretLine(view)).toBe(3);

    seedStop(A, 12, 2);
    rerender({ e: 2 });
    expect(caretLine(view)).toBe(12);
    view.destroy();
  });

  it('[T8] 用户留下非空选区后同一序号不再夺回', () => {
    const view = makeView();
    seedStop(A, 10, 1);
    const { rerender } = renderReveal(view, A);
    expect(caretLine(view)).toBe(10);

    // 用户选中一段文本（非空选区即接管）：同 seq 重放不得把选区压回停止行。
    act(() => {
      view.dispatch({
        selection: { anchor: view.state.doc.line(3).from, head: view.state.doc.line(3).to },
      });
    });
    rerender({ e: 1 });
    expect(view.state.selection.main.empty).toBe(false);
    expect(caretLine(view)).toBe(3);
    view.destroy();
  });

  it('[T9] 停点结束时释放（光标未被改动才还回原位）', () => {
    const view = makeView();
    seedStop(A, 10, 1);
    const { rerender } = renderReveal(view, A);

    clearStop(2);
    rerender({ e: 1 });
    expect(view.state.selection.main.head).toBe(0);

    // 用户接管后再结束 → 不得夺走光标
    seedStop(A, 10, 3);
    rerender({ e: 2 });
    expect(caretLine(view)).toBe(10);
    moveCaret(view, 3);
    clearStop(4);
    rerender({ e: 3 });
    expect(caretLine(view)).toBe(3);
    view.destroy();
  });

  it('[T9] 本文件从未被放置过 → 结束时不动作', () => {
    const view = makeView();
    seedStop(B, 9, 1);
    const { rerender } = renderReveal(view, A);
    expect(view.state.selection.main.head).toBe(0);

    clearStop(2);
    rerender({ e: 1 });
    expect(view.state.selection.main.head).toBe(0);
    view.destroy();
  });

  it('[T13] 停点行超出文档长度 → 不伪造位置（不放置、留日志、不记账）', () => {
    const view = makeView();
    seedStop(A, 99, 1); // 文档只有 30 行
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { rerender } = renderReveal(view, A);

      // 钳到末行会让光标停在无对应语句的位置，且黄线/闪蓝都会因越界被丢弃 ⇒ 宁可不动。
      expect(view.state.selection.main.head).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        '[debug] stop line is beyond the document',
        expect.objectContaining({ identity: A, line: 99, docLines: 30 }),
      );

      // 不记账 ⇒ 同一序号重放时会再次尝试（而不是被当成「已放置」而静默跳过）；
      // 但**告警按「同一事件只报一次」去重**，故重放不再打印。
      rerender({ e: 1 });
      expect(view.state.selection.main.head).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);

      // 新事件（新序号）仍然会报 —— 去重不能把不同停点也吞掉。
      seedStop(A, 99, 2);
      rerender({ e: 2 });
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
      view.destroy();
    }
  });

  it('[T16] 同一越界停点在多副本挂载下只告警一次（split / pinned 布局）', () => {
    // 切片 4 之前 FileViewer 对每个 pane 渲染全部 file tab ⇒ 同一 tabId 有 2–3 份挂载。
    const viewA = makeView();
    const viewB = makeView();
    seedStop(A, 99, 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      renderReveal(viewA, A);
      renderReveal(viewB, A);

      expect(viewA.state.selection.main.head).toBe(0);
      expect(viewB.state.selection.main.head).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      viewA.destroy();
      viewB.destroy();
    }
  });

  it('[T10] 停点在别的文件 → 本视图不发生任何动作', () => {
    const view = makeView();
    seedStop(B, 9);

    renderReveal(view, A);

    expect(view.state.selection.main.head).toBe(0);
    expect(flashLines(view)).toEqual([]);
    view.destroy();
  });
});
