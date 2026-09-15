import type { EditorView } from '@codemirror/view';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebugStore } from '@/features/runner/store/debugStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { DapSessionInfo } from '@/shared/types';

import {
  debugPathsMatch,
  resolveDebugHighlightLine,
  useCurrentLineHighlight,
} from '../useCurrentLineHighlight';

describe('debugPathsMatch — 只做路径形态容错，不做身份转换', () => {
  const CACHE =
    '/Users/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java';
  const JDT = 'jdt:/java.base/java/io/PrintStream.java';

  it('普通路径形态容错', () => {
    expect(debugPathsMatch('/repo/a.go', 'a.go')).toBe(true);
    expect(debugPathsMatch('/repo/a.go', '/other/b.go')).toBe(false);
  });

  it('身份转换不在此处：缓存路径与 jdt 身份是两个不同字符串', () => {
    // 归一统一在 sourceIdentityOf（tab 身份 / stoppedAt 写入时）完成；
    // 本函数若再次做身份转换，就是把「两种身份」重新引回消费侧。
    expect(debugPathsMatch(CACHE, JDT)).toBe(false);
    expect(debugPathsMatch(JDT, JDT)).toBe(true);
  });
});

describe('resolveDebugHighlightLine', () => {
  it('should_return_null_when_no_stoppedAt', () => {
    expect(resolveDebugHighlightLine('/p/a.go', 'a.go', null, 'stopped')).toBeNull();
  });

  it('should_highlight_when_paths_match_and_stopped', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { filePath: '/Users/me/proj/main.go', line: 7 },
        'stopped',
      ),
    ).toBe(7);
  });

  it('should_not_highlight_when_session_running', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { filePath: '/Users/me/proj/main.go', line: 7 },
        'running',
      ),
    ).toBeNull();
  });

  it('should_not_highlight_when_terminated', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { filePath: '/Users/me/proj/main.go', line: 7 },
        'terminated',
      ),
    ).toBeNull();
  });
});

describe('useCurrentLineHighlight — 停点结束后释放调试放置的光标（注入式）', () => {
  /** 极简 view：本文件只验证"调用哪个释放函数、传什么行号"（光标真实效果由 editor 侧测）。 */
  const fakeView = { dispatch: vi.fn() } as unknown as EditorView;
  const viewRef = { current: fakeView };

  const sessionWith = (status: string) =>
    ({
      sessionId: 's1',
      projectId: 'p1',
      projectPath: '/p',
      configName: 'cfg',
      status,
    }) as DapSessionInfo;

  let releasePlacedCaret: ReturnType<typeof vi.fn>;

  const render = () =>
    renderHook(() => useCurrentLineHighlight('a.ts', 'a.ts', viewRef, 0, releasePlacedCaret));

  beforeEach(() => {
    releasePlacedCaret = vi.fn();
    useDebugStore.setState({ stoppedAt: null, session: null });
    useProjectStore.setState({ activeProjectId: 'p1', activeProject: { id: 'p1' } as never });
  });

  it('停点结束时按最后一次占用的行释放；占用期间不释放', () => {
    const { rerender } = render();

    // 停在 2 行 → 占用（不得释放）
    act(() => {
      useDebugStore.setState({
        stoppedAt: { filePath: 'a.ts', line: 2 },
        session: sessionWith('stopped'),
      });
    });
    rerender();
    expect(releasePlacedCaret).not.toHaveBeenCalled();

    // 会话终止 → 释放，且用的是最后一次占用的行
    act(() => {
      useDebugStore.setState({ stoppedAt: null, session: sessionWith('terminated') });
    });
    rerender();
    expect(releasePlacedCaret).toHaveBeenCalledTimes(1);
    expect(releasePlacedCaret).toHaveBeenCalledWith(fakeView, 2);
  });

  it('继续运行同样释放（不必等会话结束）', () => {
    const { rerender } = render();
    act(() => {
      useDebugStore.setState({
        stoppedAt: { filePath: 'a.ts', line: 5 },
        session: sessionWith('stopped'),
      });
    });
    rerender();

    act(() => {
      useDebugStore.setState({ stoppedAt: null, session: sessionWith('running') });
    });
    rerender();
    expect(releasePlacedCaret).toHaveBeenCalledWith(fakeView, 5);
  });

  it('从未占用过本文件 → 不释放为空操作', () => {
    const { rerender } = render();
    act(() => {
      useDebugStore.setState({
        stoppedAt: { filePath: 'other.ts', line: 9 },
        session: sessionWith('stopped'),
      });
    });
    rerender();
    act(() => {
      useDebugStore.setState({ stoppedAt: null, session: sessionWith('terminated') });
    });
    rerender();

    expect(releasePlacedCaret).not.toHaveBeenCalled();
  });
});
