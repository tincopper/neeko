import { listen } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAP_SESSION_STATUS_EVENT } from '@/shared/events';

import type { DapSessionInfo } from '../../../types';
import { useDebugStore } from '../../debugStore';

type StatusListener = (event: { payload: DapSessionInfo }) => void;

async function grabStatusListener(): Promise<StatusListener> {
  await useDebugStore.getState().subscribeEvents();
  const calls = vi.mocked(listen).mock.calls;
  const call = calls.find(([name]) => name === DAP_SESSION_STATUS_EVENT);
  if (!call) throw new Error('dap-session-status listener not registered');
  return call[1] as unknown as StatusListener;
}

function terminatedInfo(): DapSessionInfo {
  return {
    sessionId: 's-dead',
    projectId: 'p1',
    projectPath: '/proj',
    configName: 'cfg',
    status: 'terminated',
    statusMessage: 'Session terminated',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDebugStore.setState({
    session: null,
    frames: [],
    variables: [],
    location: null,
    locationSeq: 0,
    generation: null,
  });
});

describe('eventsSlice 空窗 terminated（评审 P6 顺手堵）', () => {
  it('!cur + terminated → 忽略：死通知不许凭空创建会话', async () => {
    const handler = await grabStatusListener();
    handler({ payload: terminatedInfo() });

    const s = useDebugStore.getState();
    expect(s.session).toBeNull();
    expect(s.frames).toEqual([]);
  });

  it('!cur + ended → 忽略', async () => {
    const handler = await grabStatusListener();
    handler({ payload: { ...terminatedInfo(), status: 'ended' } });
    expect(useDebugStore.getState().session).toBeNull();
  });

  it('正常终止（cur 存在）照常清理', async () => {
    useDebugStore.setState({
      session: {
        sessionId: 's1',
        projectId: 'p1',
        projectPath: '/proj',
        configName: 'cfg',
        status: 'stopped',
      },
      frames: [{ id: 1, name: 'main', sourcePath: '/proj/main.go', line: 3, column: 1 }],
    });
    const handler = await grabStatusListener();
    handler({ payload: { ...terminatedInfo(), sessionId: 's1' } });

    const s = useDebugStore.getState();
    expect(s.session?.status).toBe('terminated');
    expect(s.frames).toEqual([]);
  });

  it('stale terminated（sessionId ≠ cur）不覆盖新会话（架构审查 Major：rerun 停旧起新）', async () => {
    useDebugStore.setState({
      session: {
        sessionId: 's2',
        projectId: 'p1',
        projectPath: '/proj',
        configName: 'cfg',
        status: 'running',
      },
    });
    const handler = await grabStatusListener();
    // 旧会话（s1）的 terminated 在 s2 已建立后晚到 —— 必须忽略，不得 endedSessionPatch 覆盖。
    handler({ payload: { ...terminatedInfo(), sessionId: 's1' } });

    const s = useDebugStore.getState();
    expect(s.session?.sessionId).toBe('s2');
    expect(s.session?.status).toBe('running');
  });

  it('running 状态流在 !cur 时仍可建会话（非死亡通知不受影响）', async () => {
    const handler = await grabStatusListener();
    handler({
      payload: {
        sessionId: 's2',
        projectId: 'p1',
        projectPath: '/proj',
        configName: 'cfg',
        status: 'starting',
      },
    });
    expect(useDebugStore.getState().session?.sessionId).toBe('s2');
  });
});
