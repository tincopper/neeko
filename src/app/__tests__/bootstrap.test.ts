import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  preload: vi.fn(),
}));

vi.mock('../registerGlobalErrorHandlers', () => ({
  registerGlobalErrorHandlers: mocks.register,
}));

vi.mock('@/shared/utils/terminal', () => ({
  preloadRendererAddons: mocks.preload,
}));

describe('bootstrap', () => {
  beforeEach(() => {
    mocks.register.mockClear();
    mocks.preload.mockClear();
    vi.resetModules();
  });

  it('一次性完成错误兜底注册与 renderer 预热', async () => {
    const { bootstrap } = await import('../bootstrap');
    bootstrap();
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.preload).toHaveBeenCalledTimes(1);
  });
});
