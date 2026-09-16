import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDebugStore } from '@/features/runner/store/debugStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { DapSessionInfo } from '@/shared/types';

import { useStopLocation } from '../useStopLocation';

const REPO = '/repo';
const A = `${REPO}/src/A.java`;

function sessionWith(projectId = 'p1'): DapSessionInfo {
  return {
    sessionId: 's1',
    projectId,
    projectPath: REPO,
    configName: 'cfg',
    status: 'stopped',
  };
}

beforeEach(() => {
  useDebugStore.setState({ session: null, location: null, locationSeq: 0, generation: null });
  useProjectStore.setState({
    activeProjectId: 'p1',
    activeProject: { id: 'p1', path: REPO } as never,
  });
});

describe('useStopLocation — 编辑器侧的停点输入面', () => {
  it('should_return_null_without_a_session', () => {
    useDebugStore.setState({ location: { identity: A, line: 3, column: 0 }, locationSeq: 1 });
    expect(renderHook(() => useStopLocation()).result.current).toBeNull();
  });

  it('should_return_null_for_a_session_of_another_project（#14 门控）', () => {
    useDebugStore.setState({
      session: sessionWith('other-project'),
      location: { identity: A, line: 3, column: 0 },
      locationSeq: 1,
    });
    expect(renderHook(() => useStopLocation()).result.current).toBeNull();
  });

  it('should_return_null_when_there_is_no_stop_location', () => {
    useDebugStore.setState({ session: sessionWith(), location: null, locationSeq: 2 });
    expect(renderHook(() => useStopLocation()).result.current).toBeNull();
  });

  it('should_return_null_when_no_project_is_active', () => {
    // 没有 activeProject 就没有「属于谁」的概念 —— 不得放任画线 / 夺光标。
    useDebugStore.setState({
      session: sessionWith(),
      location: { identity: A, line: 12, column: 4 },
      locationSeq: 7,
    });
    useProjectStore.setState({ activeProjectId: null, activeProject: null });

    expect(renderHook(() => useStopLocation()).result.current).toBeNull();
  });

  it('should_expose_identity_line_column_and_location_seq', () => {
    useDebugStore.setState({
      session: sessionWith(),
      location: { identity: A, line: 12, column: 4 },
      locationSeq: 7,
    });

    expect(renderHook(() => useStopLocation()).result.current).toEqual({
      identity: A,
      line: 12,
      column: 4,
      seq: 7,
      status: 'stopped',
    });
  });

  it('should_expose_the_session_status（消费者不必再单独读会话）', () => {
    // 状态门（`starting` / `running`）是停点匹配的输入之一：位置与状态同源，一次交出，
    // 否则编辑器侧两个 hook 会各自再订阅一次会话（切片 3 / F5，护栏 12 钉住结构）。
    useDebugStore.setState({
      session: { ...sessionWith(), status: 'running' },
      location: { identity: A, line: 12, column: 4 },
      locationSeq: 7,
    });

    expect(renderHook(() => useStopLocation()).result.current?.status).toBe('running');
  });

  it('should_keep_reference_identity_across_rerenders（防 useSyncExternalStore 无限重渲）', () => {
    useDebugStore.setState({
      session: sessionWith(),
      location: { identity: A, line: 12, column: 0 },
      locationSeq: 1,
    });
    const { result, rerender } = renderHook(() => useStopLocation());

    const first = result.current;
    rerender();
    rerender();

    // 值未变时必须返回**同一个引用**：返回新对象会让 getSnapshot 每次不同 →
    // React 判定 tearing 并持续重渲。
    expect(result.current).toBe(first);
  });
});
