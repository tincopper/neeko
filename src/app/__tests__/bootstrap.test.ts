import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
}));

// bootstrap 不再自己列举启动动作；它只把全部 owner 交给唯一清单安装。
vi.mock('@/app/bootstrap/globalOwners', () => ({
  installGlobalOwners: mocks.install,
}));

describe('bootstrap', () => {
  beforeEach(() => {
    mocks.install.mockClear();
    vi.resetModules();
  });

  it('一次性把全部启动期 owner 交给唯一清单安装', async () => {
    const { bootstrap } = await import('../bootstrap');
    bootstrap();
    expect(mocks.install).toHaveBeenCalledTimes(1);
  });

  it('main.tsx 必须先 bootstrap 再 render（首帧主题注入的顺序契约）', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(path.resolve(process.cwd(), 'src/app/main.tsx'), 'utf-8');
    expect(source.indexOf('bootstrap()')).toBeLessThan(source.indexOf('createRoot('));
  });
});
