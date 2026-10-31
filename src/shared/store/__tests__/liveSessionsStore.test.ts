import { beforeEach, describe, expect, it } from 'vitest';

import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import type { SessionView } from '@/shared/types/liveSessions';

function session(sessionId: string): SessionView {
  return {
    sessionId,
    kind: 'terminal',
    agentId: null,
    workspaceKey: 'p1\0',
    title: sessionId,
    titleSource: 'placeholder',
    state: 'running',
    startedAt: '2026-10-31T10:00:00.000Z',
    updatedAt: '2026-10-31T10:00:00.000Z',
    turnCount: 0,
  };
}

const initial = useLiveSessionsStore.getState();

describe('useLiveSessionsStore', () => {
  beforeEach(() => {
    useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null }, false);
  });

  it('apply 写入快照、版本与 hydrate 时刻', () => {
    expect(useLiveSessionsStore.getState().apply({ version: 3, sessions: [session('a')] })).toBe(
      true,
    );
    const state = useLiveSessionsStore.getState();
    expect(state.version).toBe(3);
    expect(state.sessions.map((s) => s.sessionId)).toEqual(['a']);
    expect(state.hydratedAt).not.toBeNull();
  });

  it('版本更旧的回包被丢弃（不打断已在展示的新快照）', () => {
    useLiveSessionsStore.getState().apply({ version: 5, sessions: [session('new')] });

    expect(useLiveSessionsStore.getState().apply({ version: 4, sessions: [session('old')] })).toBe(
      false,
    );
    expect(useLiveSessionsStore.getState().version).toBe(5);
    expect(useLiveSessionsStore.getState().sessions.map((s) => s.sessionId)).toEqual(['new']);
  });

  it('同版本回包允许覆盖（同一版本可能携带不同视图 —— 例如按单元过滤的请求）', () => {
    useLiveSessionsStore.getState().apply({ version: 2, sessions: [session('a')] });
    expect(useLiveSessionsStore.getState().apply({ version: 2, sessions: [session('b')] })).toBe(
      true,
    );
    expect(useLiveSessionsStore.getState().sessions.map((s) => s.sessionId)).toEqual(['b']);
  });

  it('默认态是空快照（首次 hydrate 前不渲染任何会话）', () => {
    expect(initial.version).toBe(0);
    expect(initial.sessions).toEqual([]);
    expect(initial.hydratedAt).toBeNull();
  });
});
