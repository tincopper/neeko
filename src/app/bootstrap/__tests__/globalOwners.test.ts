import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  errorHandlers: vi.fn(() => vi.fn()),
  inputGuard: vi.fn(() => vi.fn()),
  rendererAddons: vi.fn(),
  dockPolicy: vi.fn(),
  themeHint: vi.fn(),
  quickOpenTracking: vi.fn(() => vi.fn()),
  scrollAutoHide: vi.fn(() => vi.fn()),
}));

vi.mock('@/app/registerGlobalErrorHandlers', () => ({
  registerGlobalErrorHandlers: mocks.errorHandlers,
}));
vi.mock('@/shared/utils/webkitInputGuard', () => ({ installWebKitInputGuard: mocks.inputGuard }));
vi.mock('@/shared/utils/terminal', () => ({ preloadRendererAddons: mocks.rendererAddons }));
vi.mock('@/app/dock/registerNewTabDockPolicy', () => ({
  registerNewTabDockPolicy: mocks.dockPolicy,
}));
vi.mock('../configProjection', () => ({ applyThemeHintBeforeRender: mocks.themeHint }));
vi.mock('@/features/quick-open', () => ({
  startQuickOpenActivityTracking: mocks.quickOpenTracking,
}));
vi.mock('@/shared/utils/scrollAutoHide', () => ({ initScrollAutoHide: mocks.scrollAutoHide }));

import { GLOBAL_OWNERS, installGlobalOwners } from '../globalOwners';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('globalOwners — 唯一清单', () => {
  it('id 唯一、preRender 都有 start、reactHook 恰为 liveSessionsBridge', () => {
    const ids = GLOBAL_OWNERS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      GLOBAL_OWNERS.filter((o) => o.phase === 'preRender').every(
        (o) => typeof o.start === 'function',
      ),
    ).toBe(true);
    expect(GLOBAL_OWNERS.filter((o) => o.phase === 'reactHook').map((o) => o.id)).toEqual([
      'liveSessionsBridge',
    ]);
  });

  it('rendererAddons 必须排在 themeHint / render 之前（模块缓存竞态契约）', () => {
    const renderer = GLOBAL_OWNERS.findIndex((o) => o.id === 'rendererAddons');
    const theme = GLOBAL_OWNERS.findIndex((o) => o.id === 'themeHint');
    expect(renderer).toBeGreaterThanOrEqual(0);
    expect(renderer).toBeLessThan(theme);
  });

  it('installGlobalOwners 每个 preRender owner 恰好启动一次', () => {
    const dispose = installGlobalOwners();
    expect(mocks.errorHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.inputGuard).toHaveBeenCalledTimes(1);
    expect(mocks.rendererAddons).toHaveBeenCalledTimes(1);
    expect(mocks.dockPolicy).toHaveBeenCalledTimes(1);
    expect(mocks.themeHint).toHaveBeenCalledTimes(1);
    expect(mocks.quickOpenTracking).toHaveBeenCalledTimes(1);
    expect(mocks.scrollAutoHide).toHaveBeenCalledTimes(1);
    expect(typeof dispose).toBe('function');
  });

  it('dispose 调用所有返回的 cleanup（不丢弃监听清理）', () => {
    const dispose = installGlobalOwners();
    const cleanups = [
      mocks.errorHandlers.mock.results[0].value,
      mocks.inputGuard.mock.results[0].value,
      mocks.quickOpenTracking.mock.results[0].value,
      mocks.scrollAutoHide.mock.results[0].value,
    ] as Array<() => void>;
    dispose();
    for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
