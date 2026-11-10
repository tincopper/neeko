import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSessionsByUnit } from '@/shared/hooks/useSessionsByUnit';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import type { SessionView } from '@/shared/types/liveSessions';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const MAIN_KEY = WorkspaceSession.of('p1', null).key;
const WT_KEY = WorkspaceSession.of('p1', '/proj/.worktrees/dev').key;

function session(sessionId: string, workspaceKey: string): SessionView {
  return {
    sessionId,
    kind: 'terminal',
    agentId: null,
    workspaceKey,
    title: `title-${sessionId}`,
    titleSource: 'prompt',
    state: 'running',
    startedAt: '2026-10-31T10:00:00.000Z',
    updatedAt: '2026-10-31T10:00:00.000Z',
    // 侧栏列出要求「首轮已跑完」；本组用例测的是分组，不测可见性。
    turnCount: 1,
    hasUserInput: true,
  };
}

function seed(sessions: SessionView[], version = 1): void {
  useLiveSessionsStore.setState({ version, sessions, hydratedAt: null }, false);
}

describe('useSessionsByUnit', () => {
  beforeEach(() => {
    useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null }, false);
  });

  it('按 workspaceKey 分组（每单元的会话保持快照顺序）', () => {
    seed([session('a', MAIN_KEY), session('b', WT_KEY), session('c', MAIN_KEY)]);
    const { result } = renderHook(() => useSessionsByUnit());

    expect(result.current.get(MAIN_KEY)?.map((s) => s.sessionId)).toEqual(['a', 'c']);
    expect(result.current.get(WT_KEY)?.map((s) => s.sessionId)).toEqual(['b']);
  });

  it('同一份快照复用同一个 Map（行组件的 memo 才有效）', () => {
    seed([session('a', MAIN_KEY)]);
    const { result, rerender } = renderHook(() => useSessionsByUnit());
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);
  });

  it('快照被替换后重新分组（新 Map，新内容）', () => {
    seed([session('a', MAIN_KEY)]);
    const { result } = renderHook(() => useSessionsByUnit());
    const first = result.current;

    act(() => {
      useLiveSessionsStore
        .getState()
        .apply({ version: 2, sessions: [session('a', MAIN_KEY), session('b', WT_KEY)] });
    });

    expect(result.current).not.toBe(first);
    expect(result.current.get(WT_KEY)?.map((s) => s.sessionId)).toEqual(['b']);
  });

  it('乱序回包被 store 丢弃 ⇒ 分组结果不变', () => {
    seed([session('a', MAIN_KEY)], 5);
    const { result } = renderHook(() => useSessionsByUnit());
    const first = result.current;

    act(() => {
      // 版本更旧的回包不得覆盖当前快照（store 的唯一职责）
      useLiveSessionsStore.getState().apply({ version: 4, sessions: [] });
    });

    expect(result.current).toBe(first);
  });
});
