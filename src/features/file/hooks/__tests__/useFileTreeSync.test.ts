import { listen } from '@tauri-apps/api/event';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reportFrontendError } from '@/shared/utils/errorReporting';

import { useFileTreeSync, type UseFileTreeSyncOptions } from '../useFileTreeSync';

// 注册竞态模拟：tauri 注入脚本 `unregisterListener` 读 `listeners[eventId].handlerId`
// 时该条目尚未由 listen_js_script eval 填充 → 同步抛错（async _unlisten reject）。
// 错误串与 safeUnlisten.test.ts 记录的线上报错逐字一致。
const RACE_ERROR = new Error(
  "undefined is not an object (evaluating 'listeners[eventId].handlerId')",
);

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('@/features/file/api/fileApi', () => ({
  readDirTree: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/shared/utils/errorReporting', () => ({
  reportFrontendError: vi.fn(),
}));

const listenMock = vi.mocked(listen);
const reportMock = vi.mocked(reportFrontendError);

/** 首次调用以注册竞态错误 reject（unlisten 早于事件表填充），重试成功。 */
function makeRaceUnlisten() {
  let calls = 0;
  const fn = vi.fn(() => {
    calls += 1;
    if (calls === 1) return Promise.reject(RACE_ERROR);
    return Promise.resolve();
  });
  return fn;
}

function makeOptions(overrides: Partial<UseFileTreeSyncOptions> = {}): UseFileTreeSyncOptions {
  return {
    project: { id: 'p1', type: 'Local' } as UseFileTreeSyncOptions['project'],
    commands: null,
    activeProjectId: 'p1',
    fileRootPath: '/tmp/proj',
    ignoredFiles: [],
    isActive: true,
    onLoadFileTree: vi.fn(),
    onFileRefresh: vi.fn(),
    onExpandDir: vi.fn(),
    ...overrides,
  };
}

describe('useFileTreeSync — file-tree-changed 订阅注销竞态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('项目切换重订阅时清理旧监听命中注册竞态 → 重试补执行 Rust 侧注销，不上报 toast', async () => {
    // 第一个项目的订阅：其 unlisten 在清理时命中竞态（首次 reject，重试成功）
    const raceUnlisten = makeRaceUnlisten();
    // 第二个项目的订阅：正常注销
    const plainUnlisten = vi.fn(() => Promise.resolve());
    listenMock
      .mockReturnValueOnce(Promise.resolve(raceUnlisten))
      .mockReturnValueOnce(Promise.resolve(plainUnlisten));

    const { rerender } = renderHook((props: UseFileTreeSyncOptions) => useFileTreeSync(props), {
      initialProps: makeOptions(),
    });

    // 模拟项目切换：activeProjectId 变化 → effect 重跑 → 清理第一个订阅
    rerender(makeOptions({ project: { id: 'p2', type: 'Local' } as never, activeProjectId: 'p2' }));

    // 竞态防护的重试经 setTimeout(0) 收敛
    await new Promise((r) => setTimeout(r, 10));

    // 契约 1：Rust 侧注销最终补执行（首次 reject 不容忍丢失 → 监听泄漏）
    expect(raceUnlisten).toHaveBeenCalledTimes(2);
    // 契约 2：重试成功 → 不触发用户可见 toast（reportFrontendError）
    expect(reportMock).not.toHaveBeenCalled();
  });
});
