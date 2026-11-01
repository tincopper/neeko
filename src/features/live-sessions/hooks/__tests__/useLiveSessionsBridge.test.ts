import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type EventCb = (event: { payload: unknown }) => void;
type WaitResolver = (value: { version: number; changed: boolean }) => void;

const { listeners, invokeMock, waitResolvers, snapshots } = vi.hoisted(() => ({
  listeners: {} as Record<string, EventCb[]>,
  invokeMock: vi.fn(),
  waitResolvers: [] as WaitResolver[],
  /** 依次供 `list_live_sessions` 消费的快照队列。 */
  snapshots: [] as Array<{ version: number; sessions: unknown[] }>,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, cb: EventCb) => {
    (listeners[event] ??= []).push(cb);
    return Promise.resolve(() => {
      listeners[event] = (listeners[event] ?? []).filter((fn) => fn !== cb);
    });
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { SESSIONS_EVENT } from '@/shared/events';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import type { SessionView } from '@/shared/types/liveSessions';

import { useLiveSessionsBridge } from '../useLiveSessionsBridge';

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
    hasUserInput: true,
  };
}

function listCalls(): number {
  return invokeMock.mock.calls.filter(([command]) => command === 'list_live_sessions').length;
}

function emit(payload: unknown): void {
  act(() => {
    for (const cb of listeners[SESSIONS_EVENT] ?? []) cb({ payload });
  });
}

/** 长轮询在真实环境里挂起 25s；测试里让它只挂起，由用例决定何时推进。 */
function resolvePendingWait(value: { version: number; changed: boolean }): void {
  const pending = waitResolvers.splice(0, waitResolvers.length);
  act(() => {
    for (const resolve of pending) resolve(value);
  });
}

describe('useLiveSessionsBridge', () => {
  beforeEach(() => {
    useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null }, false);
    listeners[SESSIONS_EVENT] = [];
    waitResolvers.length = 0;
    snapshots.length = 0;
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === 'list_live_sessions') {
        return Promise.resolve(snapshots.shift() ?? { version: 0, sessions: [] });
      }
      if (command === 'wait_live_sessions') {
        return new Promise<never>((resolve) => waitResolvers.push(resolve));
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });
  });

  it('挂载即 hydrate：拉一次快照并写入 store', async () => {
    snapshots.push({ version: 1, sessions: [session('s1')] });

    renderHook(() => useLiveSessionsBridge());

    await waitFor(() => expect(useLiveSessionsStore.getState().version).toBe(1));
    expect(useLiveSessionsStore.getState().sessions.map((s) => s.sessionId)).toEqual(['s1']);
    expect(listCalls()).toBe(1);
  });

  it('事件版本不大于本地时不重拉（事件只表示「有变更」）', async () => {
    snapshots.push({ version: 1, sessions: [] });
    renderHook(() => useLiveSessionsBridge());
    await waitFor(() => expect(useLiveSessionsStore.getState().version).toBe(1));

    emit({ version: 1 });
    await Promise.resolve();

    expect(listCalls()).toBe(1);
  });

  it('事件版本更大时重拉快照', async () => {
    snapshots.push({ version: 1, sessions: [] });
    renderHook(() => useLiveSessionsBridge());
    await waitFor(() => expect(useLiveSessionsStore.getState().version).toBe(1));

    snapshots.push({ version: 2, sessions: [session('s2')] });
    emit({ version: 2 });

    await waitFor(() => expect(useLiveSessionsStore.getState().version).toBe(2));
    expect(listCalls()).toBe(2);
    expect(useLiveSessionsStore.getState().sessions.map((s) => s.sessionId)).toEqual(['s2']);
  });

  it('乱序回包被丢弃：旧版本快照不会把 store 打回去', async () => {
    snapshots.push({ version: 3, sessions: [session('fresh')] });
    renderHook(() => useLiveSessionsBridge());
    await waitFor(() => expect(useLiveSessionsStore.getState().version).toBe(3));

    // 事件说「变了」，但回来的快照更旧（并发请求 / 后端重建的交叉）
    snapshots.push({ version: 2, sessions: [session('stale')] });
    emit({ version: 4 });
    await Promise.resolve();
    await Promise.resolve();

    expect(useLiveSessionsStore.getState().version).toBe(3);
    expect(useLiveSessionsStore.getState().sessions.map((s) => s.sessionId)).toEqual(['fresh']);
  });

  it('长轮询报「变了」时重拉快照（事件丢失 / 漏发时仍能自愈）', async () => {
    snapshots.push({ version: 1, sessions: [] });
    renderHook(() => useLiveSessionsBridge());
    await waitFor(() => expect(useLiveSessionsStore.getState().version).toBe(1));
    expect(listCalls()).toBe(1);

    // 长轮询必须先真的挂起来（hydrate 是新起的一轮，可能还没走到 wait）
    await waitFor(() => expect(waitResolvers).toHaveLength(1));
    snapshots.push({ version: 2, sessions: [session('s2')] });
    resolvePendingWait({ version: 2, changed: true });

    await waitFor(() => expect(useLiveSessionsStore.getState().version).toBe(2));
    expect(listCalls()).toBe(2);
    expect(useLiveSessionsStore.getState().sessions.map((s) => s.sessionId)).toEqual(['s2']);
  });

  it('卸载后不再发起调用，并解绑事件监听', async () => {
    snapshots.push({ version: 1, sessions: [] });
    const { unmount } = renderHook(() => useLiveSessionsBridge());
    await waitFor(() => expect(useLiveSessionsStore.getState().version).toBe(1));
    const callsAtUnmount = listCalls();
    // 确保确实有一次在途的长轮询 —— 否则「卸载后不重拉」是空断言
    await waitFor(() => expect(waitResolvers).toHaveLength(1));

    unmount();
    await waitFor(() => expect(listeners[SESSIONS_EVENT] ?? []).toHaveLength(0));

    // 在途的长轮询在卸载后才落地：不得触发新的拉取
    resolvePendingWait({ version: 9, changed: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(listCalls()).toBe(callsAtUnmount);
    expect(useLiveSessionsStore.getState().version).toBe(1);
    expect(waitResolvers).toHaveLength(0);
  });
});
