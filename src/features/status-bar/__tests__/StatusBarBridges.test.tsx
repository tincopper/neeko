import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstallProgressBridge } from '../bridges/InstallProgressBridge';
import { LspSubscriptionBridge } from '../bridges/LspSubscriptionBridge';

const listenCapture = vi.hoisted(() => ({
  handler: null as ((e: { payload: unknown }) => void) | null,
  unlisten: vi.fn(),
}));
const lspListSessionsMock = vi.fn(() =>
  Promise.resolve([
    {
      project_path: '/proj',
      language_id: 'rust',
      server_name: 'rust-analyzer',
      status: 'ready',
      status_message: undefined,
      progress_pct: undefined,
    },
  ]),
);
const storeMock = vi.hoisted(() => ({
  setInstallProgress: vi.fn(),
  setSessionState: vi.fn(),
  subscribeToProject: vi.fn(() => Promise.resolve(listenCapture.unlisten)),
  onProjectActivated: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_: string, handler: (e: { payload: unknown }) => void) => {
    listenCapture.handler = handler;
    return Promise.resolve(listenCapture.unlisten);
  }),
}));

vi.mock('@/shared/store/lspStore', () => ({
  useLspStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({ installProgress: null, sessions: {}, profiles: {} }),
    { getState: () => storeMock },
  ),
}));

vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ activeProject: { id: 'p1', path: '/proj', name: 'demo' } }),
}));

vi.mock('@/features/lsp/api/lspApi', () => ({
  lspListSessions: (...args: unknown[]) => lspListSessionsMock(...args),
}));

/** 冲刷 bridge 内 async setup（listen/subscribe 的 promise 链）。 */
async function flushBridgeSetup() {
  // 链深 ≤3（subscribe→list→set），逐 tick 放行微任务；不用 act 包空函数。
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('statusBarBridges', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    listenCapture.handler = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('InstallProgressBridge：installing 写入 store；done 写入后 2000ms 清除', async () => {
    render(<InstallProgressBridge />);
    await flushBridgeSetup();
    expect(listenCapture.handler).not.toBeNull();
    const handler = listenCapture.handler!;

    handler({ payload: { language_id: 'rust', phase: 'installing', message: '' } });
    expect(storeMock.setInstallProgress).toHaveBeenLastCalledWith({
      language_id: 'rust',
      phase: 'installing',
      message: '',
    });

    handler({ payload: { language_id: 'rust', phase: 'done', message: '' } });
    expect(storeMock.setInstallProgress).toHaveBeenLastCalledWith({
      language_id: 'rust',
      phase: 'done',
      message: '',
    });
    expect(storeMock.setInstallProgress).not.toHaveBeenCalledWith(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(storeMock.setInstallProgress).toHaveBeenLastCalledWith(null);
  });

  it('InstallProgressBridge：error 写入后 5000ms 清除', async () => {
    render(<InstallProgressBridge />);
    await flushBridgeSetup();

    listenCapture.handler!({
      payload: { language_id: 'rust', phase: 'error', message: 'boom' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(storeMock.setInstallProgress).not.toHaveBeenCalledWith(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(storeMock.setInstallProgress).toHaveBeenLastCalledWith(null);
  });

  it('LspSubscriptionBridge：挂载订阅 + 拉取会话 + warm，卸载取消订阅', async () => {
    const { unmount } = render(<LspSubscriptionBridge />);
    await flushBridgeSetup();
    expect(storeMock.subscribeToProject).toHaveBeenCalledWith('/proj');
    expect(storeMock.onProjectActivated).toHaveBeenCalledWith('/proj');
    expect(storeMock.setSessionState).toHaveBeenCalledWith('/proj', 'rust', {
      serverName: 'rust-analyzer',
      status: 'ready',
      statusMessage: undefined,
      progressPct: undefined,
    });

    unmount();
    expect(listenCapture.unlisten).toHaveBeenCalled();
  });
});
