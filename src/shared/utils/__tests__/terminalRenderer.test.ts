import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RENDERER_EVENT_CANVAS,
  RENDERER_EVENT_RECOVERY,
  RENDERER_EVENT_RESUME,
  RENDERER_EVENT_WEBGL,
  RENDERER_EVENT_WEBGL_NULL,
} from '../terminal';

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

/**
 * WebglAddon 构造开关：置 true 时 new WebglAddon 抛错 —— 模拟「resume 时
 * GPU 上下文创建失败」（loadWebglRenderer 内部 catch → 返回 null → 降级）。
 * provideGlInternals 置 true 时构造出的 addon 携带可观测的 _renderer
 * （_gl.loseContext + _canvas），供 suspend 释放配额断言。
 */
const webglMockState = vi.hoisted(() => ({
  throwOnConstruct: false,
  provideGlInternals: false,
  /** design D7.7：true 时 onContextLoss 暴露为真实 xterm IEvent 可调用形态 */
  callableEvent: false,
  loseContext: vi.fn(),
  glCanvas: { width: 300, height: 150 },
}));

/** 每次 new WebglAddon 收到的构造参数（断言 customGlyphs 位置用）。 */
const webglConstructOptions = vi.hoisted(() => [] as unknown[]);

/** 可编程的 onContextLoss 订阅器（fireContextLoss 手动触发丢失事件）。 */
function makeEmitter() {
  const listeners = new Set<() => void>();
  const emitter = {
    event(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    fire() {
      listeners.forEach((cb) => cb());
    },
  };
  // design D7.7：真实 xterm 形状 = onContextLoss 本身是 IEvent 可调用函数，
  // 且返回 IDisposable（{ dispose }）—— 与官方 typings L18 一致。
  const callable = Object.assign(
    (cb: () => void) => {
      listeners.add(cb);
      return { dispose: () => listeners.delete(cb) };
    },
    { fire: emitter.fire },
  );
  return { objectShape: emitter, callableShape: callable };
}

let webglContextLossEmitter: ReturnType<typeof makeEmitter>['objectShape'] | null = null;

class MockWebglAddon {
  onContextLoss: unknown;
  clearTextureAtlas = vi.fn();
  dispose = vi.fn();
  _renderer?: {
    _gl: { getExtension: () => { loseContext: () => void } };
    _canvas: { width: number; height: number };
  };
  constructor(options?: unknown) {
    if (webglMockState.throwOnConstruct) throw new Error('gpu ctx failed');
    webglConstructOptions.push(options);
    const { objectShape, callableShape } = makeEmitter();
    webglContextLossEmitter = objectShape;
    this.onContextLoss = webglMockState.callableEvent ? callableShape : objectShape;
    if (webglMockState.provideGlInternals) {
      this._renderer = {
        _gl: { getExtension: () => ({ loseContext: webglMockState.loseContext }) },
        _canvas: webglMockState.glCanvas,
      };
    }
  }
}

vi.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: class MockCanvasAddon {},
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: MockWebglAddon,
}));

vi.mock('../errorReporting', () => ({
  reportFrontendError: (...args: unknown[]) => reportMock(...args),
}));

/** 每个用例重新加载被测模块，隔离模块级探测缓存（webglSupport / plan 缓存）。 */
async function loadModule() {
  vi.resetModules();
  return await import('../terminal');
}

/** 拍平恢复链中的异步 import / 微任务链。 */
async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** stub canvas 2d/webgl 探测。 */
function stubGetContext(impl: (type: string) => unknown) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    impl as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );
}

/** 构造带 disposed 标记、linkifier、refresh 与行数的伪终端（对齐 isTerminalDisposed 探测路径）。 */
function makeTerm(
  opts: { disposed?: boolean; loadAddon?: ReturnType<typeof vi.fn>; refresh?: unknown } = {},
) {
  return {
    loadAddon: opts.loadAddon ?? vi.fn(),
    refresh: (opts.refresh as import('@xterm/xterm').Terminal['refresh'] | undefined) ?? vi.fn(),
    rows: 24,
    _core: {
      _store: { isDisposed: opts.disposed ?? false },
      linkifier: {},
    },
  } as unknown as import('@xterm/xterm').Terminal;
}

beforeEach(() => {
  reportMock.mockClear();
  webglMockState.throwOnConstruct = false;
  webglMockState.provideGlInternals = false;
  webglMockState.callableEvent = false;
  webglMockState.glCanvas.width = 300;
  webglMockState.glCanvas.height = 150;
  webglConstructOptions.length = 0;
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

  // design D7.7 回归锁定：真实 WebglAddon 的 onContextLoss 是 IEvent 可调用函数
  // （typings L18），不是 { event } 事件对象。此前硬编码 .event() 对真实 addon
  // 抛 TypeError → mount 失败 → GPU 开关形同虚设（实测 2026-09-03 16:0x）。
  it('webgl 计划：真实 IEvent 可调用形状的 onContextLoss 正常挂载', async () => {
    const mod = await loadModule();
    stubGetContext((type) =>
      type === 'webgl2' ? { getExtension: () => ({ loseContext: vi.fn() }) } : null,
    );
    webglMockState.callableEvent = true;
    const term = makeTerm();

    await mod.applyRenderer(term, true);

    // 挂载成功：loadAddon 收到 addon，且没有 webgl-null 降级上报
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
    expect(reportMock).not.toHaveBeenCalledWith(RENDERER_EVENT_WEBGL_NULL, expect.anything());
    expect(reportMock).not.toHaveBeenCalledWith(RENDERER_EVENT_WEBGL, expect.anything());
  });

  it('webgl 计划：真实 IEvent 形状订阅后 context-loss 仍可触发恢复链', async () => {
    const mod = await loadModule();
    stubGetContext((type) =>
      type === 'webgl2' ? { getExtension: () => ({ loseContext: vi.fn() }) } : null,
    );
    webglMockState.callableEvent = true;
    const term = makeTerm();

    await mod.applyRenderer(term, true);
    await flushAsync();
    const callsBefore = (term.loadAddon as ReturnType<typeof vi.fn>).mock.calls.length;

    // callable 形状与 objectShape 共享 listeners → objectShape.fire() 可触发
    webglContextLossEmitter?.fire();
    await flushAsync();
    await flushAsync();

    expect((term.loadAddon as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      callsBefore,
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

  it('loadAddon 失败时显式降级到 DOM 并打点（design D7：不再静默）', async () => {
    const mod = await loadModule();
    stubGetContext(() => null);
    const term = makeTerm({
      loadAddon: vi.fn(() => {
        throw new Error('gpu ctx failed');
      }),
    });

    await expect(mod.applyRenderer(term, false)).resolves.toBeUndefined();

    // design D7 改造后：错误不再归并，分阶段打点（常量见 terminal.ts，
    // 支柱 12）给前端日志+toast 更精细的归因。
    expect(reportMock).toHaveBeenCalledWith(RENDERER_EVENT_CANVAS, expect.any(Error));
  });

  it('webgl 计划 + 终端已 disposed → 放弃加载（与 canvas 路径同守卫）', async () => {
    const mod = await loadModule();
    stubWebglSupport();
    const term = makeTerm({ disposed: true });

    await mod.applyRenderer(term, true);

    expect(term.loadAddon).not.toHaveBeenCalled();
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('detectActiveRenderer — term 已 disposed 时返回 unknown', async () => {
    const mod = await loadModule();
    const term = makeTerm({ disposed: true });
    expect(mod.detectActiveRenderer(term)).toBe('unknown');
  });

  it('detectActiveRenderer — mock 终端（无 _renderService）返回 untestable', async () => {
    const mod = await loadModule();
    const term = makeTerm();
    // makeTerm 不提供 _renderService，模拟测试/早期 init 环境
    expect(mod.detectActiveRenderer(term)).toBe('untestable');
  });

  it('detectActiveRenderer — _renderService 上挂着 WebglRenderer → webgl', async () => {
    const mod = await loadModule();
    const term = makeTerm();
    (
      term as unknown as {
        _core: { _renderService: { _renderer: { constructor: { name: string } } } };
      }
    )._core = {
      linkifier: {},
      _renderService: { _renderer: { constructor: { name: 'WebglRenderer' } } },
    } as unknown as { linkifier: unknown };
    expect(mod.detectActiveRenderer(term)).toBe('webgl');
  });

  // design D7.1：xterm 包自带 bundle 类名已压缩（实测 DomRenderer → "P"），
  // 特征属性嗅探必须对压缩类名免疫。
  it('detectActiveRenderer — 压缩类名 "P" + _gl 特征 → webgl', async () => {
    const mod = await loadModule();
    const term = makeTerm();
    (term as unknown as { _core: { _renderService: { _renderer: unknown } } })._core = {
      linkifier: {},
      _renderService: { _renderer: { _gl: {}, constructor: { name: 'P' } } },
    } as unknown as { linkifier: unknown };
    expect(mod.detectActiveRenderer(term)).toBe('webgl');
  });

  it('detectActiveRenderer — 压缩类名 "P" + _renderLayers 特征 → canvas', async () => {
    const mod = await loadModule();
    const term = makeTerm();
    (term as unknown as { _core: { _renderService: { _renderer: unknown } } })._core = {
      linkifier: {},
      _renderService: { _renderer: { _renderLayers: [], constructor: { name: 'P' } } },
    } as unknown as { linkifier: unknown };
    expect(mod.detectActiveRenderer(term)).toBe('canvas');
  });

  it('detectActiveRenderer — 压缩类名 "P" + _rowContainer 特征 → dom', async () => {
    const mod = await loadModule();
    const term = makeTerm();
    (term as unknown as { _core: { _renderService: { _renderer: unknown } } })._core = {
      linkifier: {},
      _renderService: { _renderer: { _rowContainer: {}, constructor: { name: 'P' } } },
    } as unknown as { linkifier: unknown };
    expect(mod.detectActiveRenderer(term)).toBe('dom');
  });

  // design D7.5：xterm 6 RenderService.setRenderer 实证 `_renderer.value = e` ——
  // _renderer 是 MutableDisposable holder（类名压缩后 "P"），真渲染器在 .value 上。
  // 不解包会把 holder 当 renderer 嗅探 → 恒 unknown（实测 2026-09-03）。
  it('detectActiveRenderer — holder 包装 { value: renderer } 解包后按特征判定', async () => {
    const mod = await loadModule();
    const term = makeTerm();
    (term as unknown as { _core: { _renderService: { _renderer: unknown } } })._core = {
      linkifier: {},
      _renderService: {
        _renderer: {
          value: { _renderLayers: [], constructor: { name: 'P' } },
          constructor: { name: 'P' },
        },
      },
    } as unknown as { linkifier: unknown };
    expect(mod.detectActiveRenderer(term)).toBe('canvas');
  });

  it('detectActiveRenderer — holder 包装 webgl renderer（.value 带 _gl）→ webgl', async () => {
    const mod = await loadModule();
    const term = makeTerm();
    (term as unknown as { _core: { _renderService: { _renderer: unknown } } })._core = {
      linkifier: {},
      _renderService: {
        _renderer: {
          value: { _gl: {}, _renderLayers: [], constructor: { name: 'P' } },
          constructor: { name: 'P' },
        },
      },
    } as unknown as { linkifier: unknown };
    expect(mod.detectActiveRenderer(term)).toBe('webgl');
  });

  it('detectActiveRenderer — holder 存在但 value 为空 → dom', async () => {
    const mod = await loadModule();
    const term = makeTerm();
    (term as unknown as { _core: { _renderService: { _renderer: unknown } } })._core = {
      linkifier: {},
      _renderService: { _renderer: { value: null, constructor: { name: 'P' } } },
    } as unknown as { linkifier: unknown };
    expect(mod.detectActiveRenderer(term)).toBe('dom');
  });

  it('detectActiveRenderer — _renderService 上挂着 CanvasRenderer → canvas', async () => {
    const mod = await loadModule();
    const term = makeTerm();
    (
      term as unknown as {
        _core: { _renderService: { _renderer: { constructor: { name: string } } } };
      }
    )._core = {
      linkifier: {},
      _renderService: { _renderer: { constructor: { name: 'CanvasRenderer' } } },
    } as unknown as { linkifier: unknown };
    expect(mod.detectActiveRenderer(term)).toBe('canvas');
  });

  it('detectActiveRenderer — _renderService 存在但 _renderer 是 undefined → dom', async () => {
    const mod = await loadModule();
    const term = makeTerm();
    (term as unknown as { _core: { _renderService: { _renderer: null } } })._core = {
      linkifier: {},
      _renderService: { _renderer: null },
    } as unknown as { linkifier: unknown };
    expect(mod.detectActiveRenderer(term)).toBe('dom');
  });

  it('webgl 计划 + WebglAddon 内部 catch 返回 null → 降级 Canvas', async () => {
    // design D7 救命测试：WebglAddon 即使"成功"如果什么都没挂上，强制降级
    // 不能让终端停在 DOM。
    const mod = await loadModule();
    stubWebglSupport();
    webglMockState.throwOnConstruct = true; // loadWebglRenderer 内部 catch → 返回 null
    const term = makeTerm();
    await mod.applyRenderer(term, true);
    webglMockState.throwOnConstruct = false; // 还原

    // WebglAddon 抛错 → loadWebglRenderer 返回 null → 强制走 Canvas fallback
    expect(reportMock).toHaveBeenCalledWith(RENDERER_EVENT_WEBGL_NULL, expect.any(Error));
    // Canvas fallback 也成功（mock 环境）
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
  });

  it('webgl 计划 + linkifier 缺失 → 放弃加载（dispose 竞态的另一半窗口）', async () => {
    const mod = await loadModule();
    stubWebglSupport();
    const term = makeTerm();
    (term as unknown as { _core: { linkifier: unknown } })._core.linkifier = undefined;

    await mod.applyRenderer(term, true);

    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it('webgl 计划注册 onContextLoss 恢复链：首次丢失重载 addon', async () => {
    const mod = await loadModule();
    stubGetContext((type) =>
      type === 'webgl2' ? { getExtension: () => ({ loseContext: vi.fn() }) } : null,
    );
    const term = makeTerm();

    await mod.applyRenderer(term, true);
    // 首次装载：注册链前一个 addon 已 loadAddon
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
    expect(webglContextLossEmitter).not.toBeNull();

    webglContextLossEmitter!.fire();
    // 等待恢复链微任务（reload 的 import → loadAddon）
    await flushAsync();
    await flushAsync();

    expect(term.loadAddon).toHaveBeenCalledTimes(2);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('冷却窗口内再次丢失 → 降级 Canvas 并打点', async () => {
    const mod = await loadModule();
    stubGetContext((type) =>
      type === 'webgl2' ? { getExtension: () => ({ loseContext: vi.fn() }) } : null,
    );
    const term = makeTerm();

    await mod.applyRenderer(term, true);
    // 第一次丢失 → reload（重载次数 1，冷却从此刻起算）
    webglContextLossEmitter!.fire();
    await flushAsync();
    await flushAsync();
    expect(term.loadAddon).toHaveBeenCalledTimes(2);

    // 第二次丢失：冷却窗口未过 → degrade 到 Canvas
    webglContextLossEmitter!.fire();
    await flushAsync();
    await flushAsync();

    expect(reportMock).toHaveBeenCalledWith(RENDERER_EVENT_RECOVERY, expect.any(Error));
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

/** webgl 探测通过的 stub 助手。 */
function stubWebglSupport() {
  stubGetContext((type) =>
    type === 'webgl2' ? { getExtension: () => ({ loseContext: vi.fn() }) } : null,
  );
}

/** webgl 计划装载后的终端 + 第 n 次 loadAddon 收到的 addon 实例。 */
async function setupWebglTerm(mod: typeof import('../terminal')) {
  stubWebglSupport();
  const term = makeTerm();
  await mod.applyRenderer(term, true);
  return term;
}

function loadedAddon(term: ReturnType<typeof makeTerm>, index = 0) {
  return (term.loadAddon as unknown as ReturnType<typeof vi.fn>).mock.calls[index]?.[0] as {
    clearTextureAtlas?: ReturnType<typeof vi.fn>;
    dispose?: ReturnType<typeof vi.fn>;
    constructor?: { name: string };
  };
}

describe('healWebglRenderer 节流', () => {
  it('30s 窗口内重复 heal 只清一次图集；越过窗口后放行', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon = loadedAddon(term);

    mod.healWebglRenderer(term);
    mod.healWebglRenderer(term); // 窗口内第二次 → 节流
    expect(addon.clearTextureAtlas).toHaveBeenCalledTimes(1);

    // 越过 30s 节流窗口 → 再次放行
    nowSpy.mockReturnValue(1_000_000 + 30_000 + 1);
    mod.healWebglRenderer(term);
    expect(addon.clearTextureAtlas).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('首次 heal 恒放行（lastHealAt=0 不受节流约束）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon = loadedAddon(term);

    mod.healWebglRenderer(term);
    expect(addon.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it('canvas 计划终端 heal no-op（无 addon 注册项，静默返回不抛）', async () => {
    const mod = await loadModule();
    stubGetContext(() => null);
    const term = makeTerm();
    await mod.applyRenderer(term, false);

    expect(() => mod.healWebglRenderer(term)).not.toThrow();
  });

  it('clearTextureAtlas 抛错时不推进节流时间戳（下个 attach 可重试）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon = loadedAddon(term);
    addon.clearTextureAtlas!.mockImplementationOnce(() => {
      throw new Error('atlas not initialized');
    });

    mod.healWebglRenderer(term); // 抛错 → 吞掉且 lastHealAt 不更新
    expect(() => mod.healWebglRenderer(term)).not.toThrow(); // 立即重试仍放行
    expect(addon.clearTextureAtlas).toHaveBeenCalledTimes(2);
  });
});

describe('suspendWebglRenderer / resumeWebglRenderer', () => {
  it('suspend：dispose addon 释放 GPU 配额，注册表清除（heal 随之 no-op）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon = loadedAddon(term);

    mod.suspendWebglRenderer(term);
    expect(addon.dispose).toHaveBeenCalledTimes(1);

    // 注册表已清：suspend 后的 heal 应静默 no-op（再无 addon 可清）
    expect(() => mod.healWebglRenderer(term)).not.toThrow();
    expect(addon.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it('suspend 幂等：重复 suspend 不二次 dispose', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon = loadedAddon(term);

    mod.suspendWebglRenderer(term);
    mod.suspendWebglRenderer(term); // addon 已清 → no-op
    expect(addon.dispose).toHaveBeenCalledTimes(1);
  });

  it('resume：重建新 addon 且 onContextLoss 恢复链续接（再丢失可 reload）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon1 = loadedAddon(term);

    mod.suspendWebglRenderer(term);
    await mod.resumeWebglRenderer(term);

    expect(term.loadAddon).toHaveBeenCalledTimes(2);
    const addon2 = loadedAddon(term, 1);
    expect(addon2).not.toBe(addon1); // 全新 addon 实例
    expect(addon1.dispose).toHaveBeenCalledTimes(1);

    // resume 后的恢复链应续接（emitter 现指向 addon2）→ 再丢触发 reload
    webglContextLossEmitter!.fire();
    await flushAsync();
    await flushAsync();
    expect(term.loadAddon).toHaveBeenCalledTimes(3);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('恢复计数跨 suspend/resume 存活（reloads 不归零，防无限 reload 风暴）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);

    // 第一次丢失 → reload（reloads=1，冷却从此刻起算）
    webglContextLossEmitter!.fire();
    await flushAsync();
    await flushAsync();
    expect(term.loadAddon).toHaveBeenCalledTimes(2);

    // suspend → resume：若 state 存 applyRenderer 局部闭包这里会清零；
    // 挂 RendererMeta 后 reloads=1 保留
    mod.suspendWebglRenderer(term);
    await mod.resumeWebglRenderer(term);
    expect(term.loadAddon).toHaveBeenCalledTimes(3);

    // 冷却窗口内（Date.now 未前进）再丢 → degrade 而非再次 reload
    // （清零版会 reload —— 正是要防的重载风暴）
    webglContextLossEmitter!.fire();
    await flushAsync();
    await flushAsync();
    expect(reportMock).toHaveBeenCalledWith(RENDERER_EVENT_RECOVERY, expect.any(Error));
  });

  it('canvas 计划终端 suspend/resume 均 no-op（无 GL 可治理）', async () => {
    const mod = await loadModule();
    stubGetContext(() => null);
    const term = makeTerm();
    await mod.applyRenderer(term, false);
    expect(term.loadAddon).toHaveBeenCalledTimes(1);

    expect(() => mod.suspendWebglRenderer(term)).not.toThrow();
    await mod.resumeWebglRenderer(term);
    expect(term.loadAddon).toHaveBeenCalledTimes(1); // 未新增 loadAddon
  });

  it('未 suspend 的终端 resume no-op（heal 路径覆盖，不重复重建）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);

    await mod.resumeWebglRenderer(term); // suspended=false → no-op
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
  });

  it('终端已 dispose 时 resume 放弃重建（import 竞态窗口纵深防御）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    mod.suspendWebglRenderer(term);

    (term as unknown as { _core: { _store: { isDisposed: boolean } } })._core._store.isDisposed =
      true;
    await mod.resumeWebglRenderer(term);
    expect(term.loadAddon).toHaveBeenCalledTimes(1); // 未重建
  });

  it('resume 失败 → 显式降级 Canvas 并打点（防落回 DOM renderer 内存风暴）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    expect(loadedAddon(term).constructor!.name).toBe('MockWebglAddon');

    mod.suspendWebglRenderer(term);
    webglMockState.throwOnConstruct = true; // 令 resume 时 new WebglAddon 抛错
    await mod.resumeWebglRenderer(term);

    expect(term.loadAddon).toHaveBeenCalledTimes(2);
    expect(loadedAddon(term, 1).constructor!.name).toBe('MockCanvasAddon');
    expect(reportMock).toHaveBeenCalledWith(RENDERER_EVENT_RESUME, expect.any(Error));
  });
});

/** stub document.fonts（jsdom 通常未实现 FontFaceSet）为「加载中」态，
 * 返回可手动触发 ready 的句柄 —— 驱动 P0-B 兜底 heal 的时序。 */
function stubFontsLoading() {
  const readyResolvers: Array<() => void> = [];
  const fake = {
    status: 'loading',
    ready: new Promise<void>((resolve) => readyResolvers.push(resolve)),
  };
  Object.defineProperty(document, 'fonts', { value: fake, configurable: true });
  return {
    setStatusLoaded() {
      fake.status = 'loaded';
      readyResolvers.forEach((r) => r());
    },
  };
}

describe('P0-B：字体就绪兜底 heal（registerFontsReadyHeal）', () => {
  afterEach(() => {
    // 还原 document.fonts 缺失态，避免污染其它用例
    delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it('字体加载中装载 WebGL → fonts.ready 后自动补一次 heal（真实字形重栅格化）', async () => {
    const fonts = stubFontsLoading();
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon = loadedAddon(term);
    // ready 前不自愈（图集仍待真实字体）
    expect(addon.clearTextureAtlas).not.toHaveBeenCalled();

    fonts.setStatusLoaded();
    await flushAsync();

    // ready 后兜底 heal：clearTextureAtlas → 下次绘制用真实字形重栅格化
    expect(addon.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it('字体已就绪时装载 → 不注册 ready 兜底（无多余 heal）', async () => {
    Object.defineProperty(document, 'fonts', {
      value: { status: 'loaded', ready: Promise.resolve() },
      configurable: true,
    });
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon = loadedAddon(term);

    await flushAsync();
    expect(addon.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it('无 document.fonts 环境装载 → 不抛（typeof 守卫静默跳过）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);

    expect(() => mod.healWebglRenderer(term)).not.toThrow();
  });

  it('attach-heal 后 fonts.ready 的兜底 heal 不受 30s 节流约束（独立时间戳）', async () => {
    const fonts = stubFontsLoading();
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon = loadedAddon(term);

    mod.healWebglRenderer(term); // attach-heal：占掉 attach 侧 lastHealAt（同 ms 内）
    expect(addon.clearTextureAtlas).toHaveBeenCalledTimes(1);

    fonts.setStatusLoaded();
    await flushAsync();

    // P0-B 独立戳 → 不被 attach 节流吞掉，补第二次 clear
    expect(addon.clearTextureAtlas).toHaveBeenCalledTimes(2);
  });
});

describe('WebGL 精细度对齐（design D1–D4）', () => {
  it('WebGL 装载以 { customGlyphs: true } 构造 addon（块字走矢量绘制）', async () => {
    const mod = await loadModule();
    await setupWebglTerm(mod);

    // customGlyphs 是 WebglAddon 构造参数（默认 true 即矢量实心），
    // 不得出现在 new Terminal() 选项里（该处无此字段，传了也是 no-op）
    expect(webglConstructOptions).toEqual([{ customGlyphs: true }]);
  });

  it('resume / context-loss 重建同样以 { customGlyphs: true } 构造', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);

    mod.suspendWebglRenderer(term);
    await mod.resumeWebglRenderer(term);
    webglContextLossEmitter!.fire();
    await flushAsync();
    await flushAsync();

    expect(webglConstructOptions).toEqual([
      { customGlyphs: true },
      { customGlyphs: true },
      { customGlyphs: true },
    ]);
  });

  it('heal 成功后强制 refresh 重绘（不清完留 stale 帧）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);

    mod.healWebglRenderer(term);

    // refresh(start, end) 取含端行号（与 orca refreshTerminalAfterWebglAttach 一致）
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
  });

  it('refresh 抛错不影响 heal（best-effort 重绘，时间戳照常推进）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon = loadedAddon(term);
    (term.refresh as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('render paused');
    });

    expect(() => mod.healWebglRenderer(term)).not.toThrow();
    mod.healWebglRenderer(term); // 时间戳已推进 → 节流，不再 clear
    expect(addon.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it('suspend 释放 GL 上下文（loseContext + canvas 清零，立即归还配额）', async () => {
    const mod = await loadModule();
    webglMockState.provideGlInternals = true;
    const term = await setupWebglTerm(mod);

    mod.suspendWebglRenderer(term);

    expect(webglMockState.loseContext).toHaveBeenCalledTimes(1);
    expect(webglMockState.glCanvas.width).toBe(0);
    expect(webglMockState.glCanvas.height).toBe(0);
  });

  it('reload 失败清理注册表（后续 heal 不碰废 addon）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const addon = loadedAddon(term);

    webglMockState.throwOnConstruct = true; // 令 context-loss 重建抛错
    webglContextLossEmitter!.fire();
    await flushAsync();
    await flushAsync();
    expect(term.loadAddon).toHaveBeenCalledTimes(1); // 重建失败，无新 addon

    webglMockState.throwOnConstruct = false;
    expect(() => mod.healWebglRenderer(term)).not.toThrow();
    expect(addon.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it('suspend 退订 onContextLoss（旧 emitter 不再触发恢复链）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const stale = webglContextLossEmitter!;

    mod.suspendWebglRenderer(term);
    stale.fire(); // 已退订 → 静默无事发生
    await flushAsync();
    await flushAsync();

    expect(term.loadAddon).toHaveBeenCalledTimes(1); // 无 reload
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('reload 退订被替换 addon 的恢复链（旧 emitter 不再二次重载）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);
    const first = webglContextLossEmitter!;

    first.fire(); // → reload（addon2 接管恢复链）
    await flushAsync();
    await flushAsync();
    expect(term.loadAddon).toHaveBeenCalledTimes(2);

    first.fire(); // 旧链已退订 → 无事发生（否则冷却内会误 degrade）
    await flushAsync();
    await flushAsync();
    expect(term.loadAddon).toHaveBeenCalledTimes(2);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('degrade 退订并清理注册表（heal/旧事件不再碰废 addon）', async () => {
    const mod = await loadModule();
    const term = await setupWebglTerm(mod);

    webglContextLossEmitter!.fire(); // → reload（reloads=1）
    await flushAsync();
    await flushAsync();
    webglContextLossEmitter!.fire(); // addon2 的链 → 冷却内 → degrade
    await flushAsync();
    await flushAsync();
    expect(term.loadAddon).toHaveBeenCalledTimes(3); // 初装 + 重载 + Canvas 降级

    const dead = loadedAddon(term, 1);
    expect(() => mod.healWebglRenderer(term)).not.toThrow();
    expect(dead.clearTextureAtlas).not.toHaveBeenCalled();
  });
});
