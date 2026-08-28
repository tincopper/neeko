import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RendererPlan（启动期能力探测 + 模块预热 + 确定性降级）测试。
 *
 * 设计要点回顾：
 * - 能力探测（detectWebgl）在启动期同步完成，结果缓存 —— 「支不支持」是确定的事实；
 * - 模块预热（preloadRendererAddons）把唯一的真实异步 import 挪到无终端时机，
 *   运行期 await 命中模块缓存 → 微任务原子 → dispose 宏任务无法插入竞态窗口；
 * - applyRenderer 的降级只允许发生在真正的能力边界上（loadAddon 同步失败），
 *   且必须打点可观测 —— 静默降级 = 功能不健全。
 */

const reportMock = vi.hoisted(() => vi.fn());

vi.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: class MockCanvasAddon {},
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class MockWebglAddon {},
}));

vi.mock('../errorReporting', () => ({
  reportFrontendError: (...args: unknown[]) => reportMock(...args),
}));

/** 每个用例重新加载被测模块，隔离模块级探测缓存（webglSupport / plan 缓存）。 */
async function loadModule() {
  vi.resetModules();
  return await import('../terminal');
}

/** stub canvas 2d/webgl 探测。 */
function stubGetContext(impl: (type: string) => unknown) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    impl as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );
}

/** 构造带 disposed 标记与 linkifier 的伪终端（对齐 isTerminalDisposed 探测路径）。 */
function makeTerm(opts: { disposed?: boolean; loadAddon?: ReturnType<typeof vi.fn> } = {}) {
  return {
    loadAddon: opts.loadAddon ?? vi.fn(),
    _core: {
      _store: { isDisposed: opts.disposed ?? false },
      linkifier: {},
    },
  } as unknown as import('@xterm/xterm').Terminal;
}

beforeEach(() => {
  reportMock.mockClear();
  vi.restoreAllMocks();
});

describe('detectWebgl', () => {
  it('webgl2 不可用时返回 false 并缓存结果（不重复探测）', async () => {
    const { detectWebgl } = await loadModule();
    const getContext = vi.fn(() => null);
    stubGetContext(getContext);

    expect(detectWebgl()).toBe(false);
    expect(detectWebgl()).toBe(false);
    // 模块级缓存：探测只发生一次
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it('webgl2 可用时返回 true 并通过 WEBGL_lose_context 释放探测上下文', async () => {
    const { detectWebgl } = await loadModule();
    const loseContext = vi.fn();
    const getContext = vi.fn((type: string) =>
      type === 'webgl2' ? { getExtension: () => ({ loseContext }) } : null,
    );
    stubGetContext(getContext);

    expect(detectWebgl()).toBe(true);
    // 探测上下文占用浏览器 WebGL 配额（8~16 个），必须显式释放
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('getContext 抛异常时按不支持处理（防御罕见环境）', async () => {
    const { detectWebgl } = await loadModule();
    stubGetContext(() => {
      throw new Error('webgl blocked');
    });

    expect(detectWebgl()).toBe(false);
    expect(reportMock).not.toHaveBeenCalled();
  });
});

describe('resolveRendererPlan', () => {
  it('GPU 开关关闭时确定性返回 canvas（不探测 webgl）', async () => {
    const { resolveRendererPlan } = await loadModule();
    const getContext = vi.fn(() => {
      throw new Error('should not be called');
    });
    stubGetContext(getContext);

    expect(resolveRendererPlan(false)).toBe('canvas');
    expect(getContext).not.toHaveBeenCalled();
  });

  it('GPU 开启但 webgl 不可用时确定性降级 canvas', async () => {
    const { resolveRendererPlan } = await loadModule();
    stubGetContext(() => null);

    expect(resolveRendererPlan(true)).toBe('canvas');
  });

  it('GPU 开启且 webgl 可用时返回 webgl', async () => {
    const { resolveRendererPlan } = await loadModule();
    stubGetContext((type) =>
      type === 'webgl2' ? { getExtension: () => ({ loseContext: vi.fn() }) } : null,
    );

    expect(resolveRendererPlan(true)).toBe('webgl');
  });
});

describe('applyRenderer', () => {
  it('canvas 计划：loadAddon 收到 CanvasAddon 实例', async () => {
    const mod = await loadModule();
    stubGetContext(() => null);
    const term = makeTerm();

    await mod.applyRenderer(term, false);

    expect(term.loadAddon).toHaveBeenCalledTimes(1);
    expect((term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0][0].constructor.name).toBe(
      'MockCanvasAddon',
    );
  });

  it('webgl 计划：loadAddon 收到 WebglAddon 实例', async () => {
    const mod = await loadModule();
    stubGetContext((type) =>
      type === 'webgl2' ? { getExtension: () => ({ loseContext: vi.fn() }) } : null,
    );
    const term = makeTerm();

    await mod.applyRenderer(term, true);

    expect((term.loadAddon as ReturnType<typeof vi.fn>).mock.calls[0][0].constructor.name).toBe(
      'MockWebglAddon',
    );
  });

  it('终端已 disposed 时放弃加载（import 竞态窗口的纵深防御）', async () => {
    const mod = await loadModule();
    stubGetContext(() => null);
    const term = makeTerm({ disposed: true });

    await mod.applyRenderer(term, false);

    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it('linkifier 缺失时放弃加载（dispose 竞态的另一半窗口）', async () => {
    const mod = await loadModule();
    stubGetContext(() => null);
    const term = makeTerm();
    (term as unknown as { _core: { linkifier: unknown } })._core.linkifier = undefined;

    await mod.applyRenderer(term, false);

    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it('loadAddon 失败时静默降级并打点（可观测的不健全降级）', async () => {
    const mod = await loadModule();
    stubGetContext(() => null);
    const term = makeTerm({
      loadAddon: vi.fn(() => {
        throw new Error('gpu ctx failed');
      }),
    });

    await expect(mod.applyRenderer(term, false)).resolves.toBeUndefined();

    expect(reportMock).toHaveBeenCalledWith('terminal.renderer', expect.any(Error));
  });
});

describe('preloadRendererAddons', () => {
  it('预热不抛错，且两个 addon 模块均可加载（mock 环境）', async () => {
    const mod = await loadModule();

    expect(() => mod.preloadRendererAddons()).not.toThrow();

    const canvas = await import('@xterm/addon-canvas');
    const webgl = await import('@xterm/addon-webgl');
    expect(canvas.CanvasAddon).toBeDefined();
    expect(webgl.WebglAddon).toBeDefined();
  });
});
