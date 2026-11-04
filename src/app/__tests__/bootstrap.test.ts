import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  preload: vi.fn(),
  guard: vi.fn(),
  dockPolicy: vi.fn(),
}));

vi.mock('../registerGlobalErrorHandlers', () => ({
  registerGlobalErrorHandlers: mocks.register,
}));

vi.mock('@/shared/utils/terminal', () => ({
  preloadRendererAddons: mocks.preload,
}));

vi.mock('@/shared/utils/webkitInputGuard', () => ({
  installWebKitInputGuard: mocks.guard,
}));

vi.mock('../dock/registerNewTabDockPolicy', () => ({
  registerNewTabDockPolicy: mocks.dockPolicy,
}));

describe('bootstrap', () => {
  beforeEach(() => {
    mocks.register.mockClear();
    mocks.preload.mockClear();
    mocks.dockPolicy.mockClear();
    vi.resetModules();
  });

  it('一次性完成错误兜底注册、幽灵字符守卫安装与 renderer 预热', async () => {
    const { bootstrap } = await import('../bootstrap');
    bootstrap();
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.guard).toHaveBeenCalledTimes(1);
    expect(mocks.guard).toHaveBeenCalledWith(document);
    expect(mocks.preload).toHaveBeenCalledTimes(1);
  });

  it('注册新 tab 的 surface 策略（漏了不会有任何报错，只会静默把新 tab 全落回中心）', async () => {
    const { bootstrap } = await import('../bootstrap');
    bootstrap();
    expect(mocks.dockPolicy).toHaveBeenCalledTimes(1);
  });
});
