import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useUnitsWithActiveSession } from '@/shared/hooks/useUnitsWithActiveSession';
import { useEditorStore } from '@/shared/store/editorStore';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { SessionView } from '@/shared/types/liveSessions';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const P1 = WorkspaceSession.of('p1', null).projectId;
const P2 = WorkspaceSession.of('p2', null).projectId;
const KEY_A = WorkspaceSession.of(P1, null).key;
const KEY_B = WorkspaceSession.of(P2, null).key;

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
    turnCount: 1,
    hasUserInput: true,
  };
}

function seedTwoUnits(): void {
  for (const [ws, sessionId] of [
    [WorkspaceSession.of(P1, null), 'pty-a'],
    [WorkspaceSession.of(P2, null), 'pty-b'],
  ] as const) {
    useEditorStore.getState().addTab(
      {
        id: `tab-${sessionId}`,
        scope: { kind: 'workspace', session: ws },
        title: sessionId,
        data: { kind: 'terminal', agentId: null, ptySessionId: sessionId },
      },
      'left',
    );
  }
  useLiveSessionsStore.setState({
    version: 1,
    sessions: [session('pty-a', KEY_A), session('pty-b', KEY_B)],
    hydratedAt: Date.now(),
  });
}

beforeEach(() => {
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  useProjectStore.setState({ activeProjectId: null });
  useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null });
});

describe('useUnitsWithActiveSession — 父行让出选中底只属于当前单元（R8.2）', () => {
  it('切换 activeProjectId 后旧单元不再命中（旧实现遍历所有 tab 空间 ⇒ 两个都命中）', () => {
    seedTwoUnits();
    useProjectStore.setState({ activeProjectId: P1 });
    const { result } = renderHook(() => useUnitsWithActiveSession());

    expect([...result.current]).toEqual([KEY_A]);

    act(() => {
      useProjectStore.setState({ activeProjectId: P2 });
    });

    expect([...result.current]).toEqual([KEY_B]);
  });

  it('没有激活项目 ⇒ 没有任何单元让出选中底', () => {
    seedTwoUnits();
    const { result } = renderHook(() => useUnitsWithActiveSession());
    expect(result.current.size).toBe(0);
  });
});
