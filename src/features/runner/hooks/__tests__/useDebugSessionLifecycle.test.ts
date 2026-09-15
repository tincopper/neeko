import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';

import { useDebugStore } from '../../store/debugStore';
import type { DapSessionInfo } from '../types';
import { useDebugSessionLifecycle } from '../useDebugSessionLifecycle';

function liveSessionFor(projectId: string): DapSessionInfo {
  return {
    sessionId: `sid-${projectId}`,
    projectId,
    projectPath: '/proj',
    configName: 'cfg',
    status: 'running',
  };
}

beforeEach(() => {
  useDebugStore.setState({ session: null });
  useProjectStore.setState({ activeProjectId: 'p1', activeProject: { id: 'p1' } as never });
});

describe('useDebugSessionLifecycle — 项目切换释放旧会话（#14 配套）', () => {
  it('挂载时发现 session 属于其他项目则静默终止', () => {
    useDebugStore.setState({ session: liveSessionFor('p2') });
    const stopSilent = vi.spyOn(useDebugStore.getState(), 'stopSilent').mockResolvedValue();
    renderHook(() => useDebugSessionLifecycle());
    expect(stopSilent).toHaveBeenCalledTimes(1);
    stopSilent.mockRestore();
  });

  it('activeProjectId 切换时终止旧项目 live 会话', () => {
    useDebugStore.setState({ session: liveSessionFor('p1') });
    const stopSilent = vi.spyOn(useDebugStore.getState(), 'stopSilent').mockResolvedValue();
    const { rerender } = renderHook(() => useDebugSessionLifecycle());
    expect(stopSilent).not.toHaveBeenCalled();
    // 切到 p2：p1 的 live 会话被释放
    useProjectStore.setState({ activeProjectId: 'p2', activeProject: { id: 'p2' } as never });
    rerender();
    expect(stopSilent).toHaveBeenCalledTimes(1);
    stopSilent.mockRestore();
  });

  it('session 属于新项目时不释放', () => {
    useDebugStore.setState({ session: liveSessionFor('p1') });
    const stopSilent = vi.spyOn(useDebugStore.getState(), 'stopSilent').mockResolvedValue();
    const { rerender } = renderHook(() => useDebugSessionLifecycle());
    // 切到 p2 时 session 已是 p2（属于新项目）→ 不释放
    useDebugStore.setState({ session: liveSessionFor('p2') });
    useProjectStore.setState({ activeProjectId: 'p2', activeProject: { id: 'p2' } as never });
    rerender();
    expect(stopSilent).not.toHaveBeenCalled();
    stopSilent.mockRestore();
  });

  it('session 已终止（非 live）时不释放', () => {
    useDebugStore.setState({
      session: { ...liveSessionFor('p2'), status: 'terminated' },
    });
    const stopSilent = vi.spyOn(useDebugStore.getState(), 'stopSilent').mockResolvedValue();
    renderHook(() => useDebugSessionLifecycle());
    expect(stopSilent).not.toHaveBeenCalled();
    stopSilent.mockRestore();
  });
});
