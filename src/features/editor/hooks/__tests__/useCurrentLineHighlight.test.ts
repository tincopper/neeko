import type { EditorView } from '@codemirror/view';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebugStore } from '@/features/runner/store/debugStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { DapSessionInfo } from '@/shared/types';

const applyDebugCurrentLine = vi.hoisted(() => vi.fn());

vi.mock('../useBreakpointGutter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../useBreakpointGutter')>()),
  applyDebugCurrentLine,
}));

import { useCurrentLineHighlight } from '../useCurrentLineHighlight';

/** 极简 view：本文件只验证「黄线装饰收到哪一行」（装饰真实效果由 gutter 侧测）。 */
const fakeView = { dispatch: vi.fn() } as unknown as EditorView;
const viewRef = { current: fakeView };

function sessionWith(status: string): DapSessionInfo {
  return {
    sessionId: 's1',
    projectId: 'p1',
    projectPath: '/p',
    configName: 'cfg',
    status,
  };
}

function render(epoch = 0) {
  return renderHook(({ e }: { e: number }) => useCurrentLineHighlight('a.ts', 'a.ts', viewRef, e), {
    initialProps: { e: epoch },
  });
}

beforeEach(() => {
  applyDebugCurrentLine.mockClear();
  useDebugStore.setState({ session: null, location: null, locationSeq: 0, generation: null });
  useProjectStore.setState({ activeProjectId: 'p1', activeProject: { id: 'p1' } as never });
});

describe('useCurrentLineHighlight — 黄线（停点标记；光标释放已归 useDebugStopReveal）', () => {
  it('停点落在本文件 → 标记停止行；停点移到别的文件 → 清除标记', () => {
    useDebugStore.setState({
      session: sessionWith('stopped'),
      location: { identity: 'a.ts', line: 2, column: 0 },
      locationSeq: 1,
    });
    const { rerender } = render();

    expect(applyDebugCurrentLine).toHaveBeenLastCalledWith(fakeView, 2);

    useDebugStore.setState({
      location: { identity: 'other.ts', line: 9, column: 0 },
      locationSeq: 2,
    });
    rerender({ e: 0 });

    expect(applyDebugCurrentLine).toHaveBeenLastCalledWith(fakeView, null);
  });

  it('无会话 / 会话不属于当前项目 → 不标记（#14 门控）', () => {
    useDebugStore.setState({
      location: { identity: 'a.ts', line: 2, column: 0 },
      locationSeq: 1,
    });
    render();

    expect(applyDebugCurrentLine).toHaveBeenLastCalledWith(fakeView, null);
  });

  it('视图重建（viewEpoch 变化）→ 重放标记（黄线是幂等装饰）', () => {
    useDebugStore.setState({
      session: sessionWith('stopped'),
      location: { identity: 'a.ts', line: 5, column: 0 },
      locationSeq: 1,
    });
    const { rerender } = render();
    applyDebugCurrentLine.mockClear();

    rerender({ e: 1 });

    expect(applyDebugCurrentLine).toHaveBeenCalledWith(fakeView, 5);
  });

  it('视图尚未创建（ref 为空）→ 不派发装饰（防御分支）', () => {
    useDebugStore.setState({
      session: sessionWith('stopped'),
      location: { identity: 'a.ts', line: 3, column: 0 },
      locationSeq: 1,
    });
    const emptyRef = { current: null };

    renderHook(() => useCurrentLineHighlight('a.ts', 'a.ts', emptyRef, 0));

    expect(applyDebugCurrentLine).not.toHaveBeenCalled();
  });

  it('会话运行中 / 已终止 → 不标记', () => {
    useDebugStore.setState({
      session: sessionWith('running'),
      location: { identity: 'a.ts', line: 5, column: 0 },
      locationSeq: 1,
    });
    render();

    expect(applyDebugCurrentLine).toHaveBeenLastCalledWith(fakeView, null);
  });
});
