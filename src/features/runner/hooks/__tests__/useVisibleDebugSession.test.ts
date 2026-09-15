import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';

import { useDebugStore } from '../../store/debugStore';
import { useVisibleDebugSession } from '../useVisibleDebugSession';

function sessionFor(projectId: string) {
  return {
    sessionId: 's1',
    projectId,
    projectPath: '/proj',
    configName: 'cfg',
    status: 'stopped',
  } as never;
}

beforeEach(() => {
  useDebugStore.setState({ session: null });
  useProjectStore.setState({ activeProjectId: null, activeProject: null });
});

describe('useVisibleDebugSession — 跨项目会话屏蔽（#14）', () => {
  it('session 属于当前项目时返回该会话', () => {
    useDebugStore.setState({ session: sessionFor('p1') });
    useProjectStore.setState({ activeProjectId: 'p1', activeProject: { id: 'p1' } as never });
    const { result } = renderHook(() => useVisibleDebugSession());
    expect(result.current?.projectId).toBe('p1');
  });

  it('session 属于其他项目时返回 null（选 A 项目不显示 B 项目会话）', () => {
    useDebugStore.setState({ session: sessionFor('p2') });
    useProjectStore.setState({ activeProjectId: 'p1', activeProject: { id: 'p1' } as never });
    const { result } = renderHook(() => useVisibleDebugSession());
    expect(result.current).toBeNull();
  });

  it('无活跃项目时返回 null', () => {
    useDebugStore.setState({ session: sessionFor('p1') });
    useProjectStore.setState({ activeProjectId: null, activeProject: null });
    const { result } = renderHook(() => useVisibleDebugSession());
    expect(result.current).toBeNull();
  });
});
