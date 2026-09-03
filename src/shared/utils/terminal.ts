import type { Terminal, ITheme } from '@xterm/xterm';

import { reportFrontendError } from './errorReporting';
import { isDarkTheme } from './theme';
import { planWebglRecovery, shouldHealWebgl, type WebglRecoveryState } from './webglRecovery';

/** xterm scrollback 行数预算：控制 WebContent 常驻 DOM/内存上限（原 10000）。 */
export const TERMINAL_SCROLLBACK = 5000;
/**
 * 渲染器恢复链打点名（支柱 12：Event 名常量化，禁止双端/多处各自硬编码）。
 * 测试断言一律引用此处常量，禁止字面量重复。
 */
export const RENDERER_EVENT_RESUME = 'terminal.renderer.resume';
export const RENDERER_EVENT_RECOVERY = 'terminal.renderer.recovery';
export const RENDERER_EVENT_WEBGL_NULL = 'terminal.renderer.webgl-null';
export const RENDERER_EVENT_WEBGL = 'terminal.renderer.webgl';
export const RENDERER_EVENT_CANVAS = 'terminal.renderer.canvas';

/**
 * 终端渲染器计划（确定性渲染器选型）。
 *
 * 背景与不变式（renderer-plan 设计，根治 _linkifier2 竞态与意外降级）：
 * 1. 能力探测（detectWebgl）在启动期同步完成并缓存 —— 「支不支持」是确定事实，
 *    不在终端生命周期内反复判断；
 * 2. 模块预热（preloadRendererAddons，main.tsx 启动时调用）把唯一的真实异步
 *    import 挪到「不存在任何终端」的时机；运行期 await import 命中模块缓存 →
 *    续体在微任务阶段原子执行，dispose（宏任务）无法插入 —— 竞态窗口结构性闭合；
 * 3. 降级只允许发生在真正的能力边界上（loadAddon 同步失败），且必须打点
 *    （reportFrontendError）—— 意外的静默降级 = 功能不健全（DOM renderer 正是
 *    TUI 内存风暴的根源：每格一个 span，高频重绘下 WebContent RSS 暴涨）。
 */
export type RendererPlan = 'webgl' | 'canvas';

export function isTerminalDisposed(term: Terminal): boolean {
  const core = (term as unknown as { _core?: { _store?: { isDisposed?: boolean } } })?._core;
  return !!core?._store?.isDisposed;
}

export function safeDisposeTerminal(term: Terminal): void {
  try {
    term.dispose();
  } catch {
    // xterm dispose may throw when Canvas/WebGL addon restores DomRenderer with
    // already-disposed linkifier (this._linkifier2 undefined). Swallow — terminal
    // is already detached; failing to restore fallback renderer is harmless.
  }
}

/** WebGL 探测结果缓存：探测有成本且会占用上下文配额，进程生命周期内只做一次。 */
let webglSupport: boolean | null = null;

/**
 * 同步探测 WebGL2 支持。探测用的上下文会占用浏览器 WebGL 配额（通常仅 8~16 个），
 * 必须通过 WEBGL_lose_context 显式释放。结果进程级缓存。
 */
export function detectWebgl(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) {
      webglSupport = false;
    } else {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      webglSupport = true;
    }
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/**
 * 确定性渲染器决策：GPU 开关关闭 → canvas；开启且探测通过 → webgl。
 * 纯同步、无 await —— 与终端生命周期完全解耦。
 */
export function resolveRendererPlan(gpuEnabled: boolean): RendererPlan {
  return gpuEnabled && detectWebgl() ? 'webgl' : 'canvas';
}

/**
 * 启动期预热两个 renderer addon 模块（main.tsx 调用，无条件双预热：
 * 本地 tauri:// 协议加载代价可忽略，换取运行期 import 全部命中缓存）。
 * 预热完成后，applyRenderer 内的 await import 为微任务原子操作，
 * term.dispose()（宏任务）无法插入 —— 竞态窗口结构性闭合。
 */
export function preloadRendererAddons(): void {
  void import('@xterm/addon-canvas');
  void import('@xterm/addon-webgl');
}

/** linkifier 存在性：CanvasAddon/WebglAddon.activate 会解引用 core.linkifier!，
 * dispose 竞态下它为 undefined，装载渲染层将抛
 * `undefined is not an object (this._linkifier2.onShowLinkUnderline)`。 */
function hasLinkifier(term: Terminal): boolean {
  return !!(term as unknown as { _core?: { linkifier?: unknown } })._core?.linkifier;
}

/**
 * 面向 WebglAddon 的最小接口（decoupled from @xterm/addon-webgl 类型，
 * 便于测试注入 fake）。宿主只消费 onContextLoss 事件、clearTextureAtlas
 * 自愈与 dispose。
 *
 * onContextLoss 双形状（design D7.7）：
 *  - 真实 addon（typings L18）：`IEvent<void>` —— **可调用事件函数本身**；
 *  - 测试 fake：`{ event(cb) }` 事件对象。
 * 订阅一律经 subscribeContextLoss 归一化，禁止直接 `.event()`。
 */
export interface WebglAddonLike {
  onContextLoss?:
    | ((cb: () => void, ...rest: unknown[]) => unknown)
    | { event(cb: () => void, ...rest: unknown[]): unknown };
  clearTextureAtlas?(): void;
  dispose(): void;
}

/**
 * WebGL 上下文丢失恢复处理器：按 webglRecovery 策略决定重载 addon 或降级
 * Canvas。返回新 addon 或 null（降级 / 重载失败）；外部经 loadWebglRenderer
 * 重新订阅后续 onContextLoss。
 */
export type WebglRecoveryHandler = (
  term: Terminal,
  state: WebglRecoveryState,
) => Promise<WebglAddonLike | null>;

/**
 * 活跃 WebGL 注册：以终端为键记录当前渲染器 addon 引用 + 恢复链退订函数，
 * 供上下文丢失重载 / suspend / degrade 时显式退订并 dispose 旧 addon。
 * WeakMap 键为终端对象，终端被 GC 后条目自动回收，不泄漏。
 */
interface WebglRegistration {
  addon: WebglAddonLike;
  unsubscribe: (() => void) | null;
}

const webglAddons = new WeakMap<object, WebglRegistration>();

/**
 * 订阅返回值归一化：真实 WebglAddon.onContextLoss.event 返回
 * IDisposable（{ dispose() }），测试 fake 返回裸退订函数，两者皆容。
 */
function toUnsubscribe(ret: unknown): (() => void) | null {
  if (typeof ret === 'function') return ret as () => void;
  const dispose = (ret as { dispose?: unknown } | null)?.dispose;
  if (typeof dispose === 'function') return () => (ret as { dispose(): void }).dispose();
  return null;
}

/**
 * 终端渲染器生命周期元数据（借鉴 orca pane-webgl 状态机裁剪版）：
 * plan / 恢复计数 / suspend 标记等须跨「suspend → resume」存活的状态统一
 * 挂在此处 —— 若存 applyRenderer 局部闭包，tab 切走（suspend）再切回
 * （resume）时恢复链计数会丢失，重载次数上限形同虚设（风暴放大器）。
 *
 * - plan: applyRenderer 时的确定性选型，resume 依赖它决定是否重建 GL；
 * - state: onContextLoss 恢复计数（reloads / lastReloadAt），跨 suspend 存活；
 * - suspended: 已 suspend（addon 已 dispose，等待下次 attach resume）；
 * - canvasFallback: 已降级 Canvas（P1 预留：可见性边界可重试回 WebGL）；
 * - lastHealAt: healWebglRenderer 节流时间戳（shouldHealWebgl 消费）。
 *
 * WeakMap 键为终端对象，随终端 GC 自动回收，不泄漏。
 */
interface RendererMeta {
  plan: RendererPlan;
  state: WebglRecoveryState;
  suspended: boolean;
  canvasFallback: boolean;
  lastHealAt: number;
  /**
   * P0-B 字体兜底 heal 时间戳（独立于 attach-heal 的 lastHealAt：
   * 启动期常驻终端的 fonts.ready 可能落在 attach-heal 30s 窗口内，
   * 共用戳会被节流吞掉 → 首帧锁死的 fallback 字形补不回来）。
   */
  fontHealAt: number;
}

const rendererMeta = new WeakMap<object, RendererMeta>();

function getOrCreateMeta(term: Terminal): RendererMeta {
  let meta = rendererMeta.get(term);
  if (!meta) {
    meta = {
      plan: 'canvas',
      state: { reloads: 0, lastReloadAt: 0 },
      suspended: false,
      canvasFallback: false,
      lastHealAt: 0,
      fontHealAt: 0,
    };
    rendererMeta.set(term, meta);
  }
  return meta;
}

/**
 * 订阅 addon 的 onContextLoss 事件，返回原生订阅结果（IDisposable 或函数）。
 *
 * 形状归一化（design D7.7，2026-09-03 实测教训）：
 *  - 真实 WebglAddon（typings/addon-webgl.d.ts:18）：`onContextLoss: IEvent<void>`
 *    —— **本身就是可调用事件函数**，`addon.onContextLoss(cb)` 直接订阅；
 *  - 测试 fake / 历史形状：`{ event(cb) }` 事件对象。
 * 此前按后者硬编码 `ctxLoss?.event(...)`，对真实 addon 抛
 * `TypeError: ctxLoss?.event is not a function` → mount 失败 → 恒回退 Canvas
 * （GPU 开关形同虚设的根因，实测 2026-09-03 16:0x）。
 */
function subscribeContextLoss(addon: WebglAddonLike, cb: () => void): unknown {
  const raw = (addon as unknown as { onContextLoss?: unknown }).onContextLoss;
  if (typeof raw === 'function') {
    return (raw as (cb: () => void) => unknown)(cb);
  }
  if (raw && typeof (raw as { event?: unknown }).event === 'function') {
    return (raw as { event: (cb: () => void) => unknown }).event(cb);
  }
  return undefined;
}

/** 装载 WebGL addon、订阅 onContextLoss 恢复链并登记注册表；失败返回 null。 */
function mountWebglAddon(
  term: Terminal,
  addon: WebglAddonLike,
  onContextLoss: WebglRecoveryHandler,
  state: WebglRecoveryState,
): WebglAddonLike {
  const unsubscribe = toUnsubscribe(
    subscribeContextLoss(addon, () => {
      void onContextLoss(term, state);
    }),
  );
  term.loadAddon(addon as unknown as Parameters<Terminal['loadAddon']>[0]);
  webglAddons.set(term, { addon, unsubscribe });
  // P0-B 兜底：addon 已装载、但打包字体可能尚未就绪（P0-A gate 未覆盖的
  // 路径，如启动窗口已创建的终端）→ 注册字体就绪后的补 heal。
  registerFontsReadyHeal(term);
  return addon;
}

/**
 * P0-B 兜底：打包字体就绪后，对「就绪前已装载」的 WebGL 终端补一次图集自愈。
 *
 * 竞态来源：P0-A font gate 只覆盖创建路径；字体加载完成前已经 open + 装载
 * WebGL 的终端（启动窗口创建的常驻终端）图集首帧仍会锁死 fallback 字形。
 * 本函数在 addon 装载时（applyRenderer / reloadWebglAddon / resume 三路汇聚点
 * mountWebglAddon）检查字体状态：仍在加载 → fonts.ready 后补一次 heal
 * （clearTextureAtlas → 下次绘制用真实字形重栅格化）。
 *
 * 幂等安全：字体已就绪（status='loaded'）→ no-op；ready 已 resolve 时 then
 * 仍会执行但 heal 自带 30s 节流，重复无害；终端已 dispose → 跳过；jsdom/
 * 无 fonts 环境（typeof 守卫）→ no-op。
 */
function registerFontsReadyHeal(term: Terminal): void {
  const fonts = (typeof document !== 'undefined' ? document.fonts : undefined) as
    | { ready: Promise<unknown>; status: string }
    | undefined;
  if (!fonts?.ready || fonts.status === 'loaded') return;
  fonts.ready
    .then(() => {
      if (isTerminalDisposed(term)) return;
      healWebglRendererForFontsReady(term);
    })
    .catch(() => {
      // fonts.ready reject（罕见）：静默，交由其它恢复路径
    });
}

/**
 * 动态 import 包装（字面量 specifier，Vite 可静态分析并重写到 optimizeDeps
 * 预打包产物）：失败时把模块名拼进错误消息。WebKit 的动态导入失败只有一句
 * "Importing a module script failed."（实测 2026-09-03），不指明是哪个模块
 * —— 没有模块名上下文，日志/通知对定位毫无帮助。
 */
function withImportContext(specifier: string, err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(`dynamic import('${specifier}') failed: ${detail}`);
}

/** 建立 WebGL addon 的上下文丢失恢复链，并登记到注册表；返回该 addon。 */
export async function loadWebglRenderer(
  term: Terminal,
  state: WebglRecoveryState,
  onContextLoss: WebglRecoveryHandler,
): Promise<WebglAddonLike | null> {
  let WebglAddonCtor: new (options?: unknown) => unknown;
  try {
    const mod = await import('@xterm/addon-webgl');
    if (typeof mod.WebglAddon !== 'function') {
      throw new Error("export 'WebglAddon' missing from @xterm/addon-webgl");
    }
    WebglAddonCtor = mod.WebglAddon as unknown as new (options?: unknown) => unknown;
  } catch (err) {
    // 导入失败不在此打点：applyRenderer / resume / onContextLoss 的调用方
    // 都会把 null 转成显式降级 + reportFrontendError，避免重复上报。
    // 带模块名的错误走 devLog 路径由调用方观测（此处仅 console 便于 dev 排查）。
    console.error(withImportContext('@xterm/addon-webgl', err));
    return null;
  }
  try {
    // customGlyphs 是 WebglAddon 构造参数（非 Terminal 选项）：true = 块/框线/
    // Powerline 等走矢量 fillRect（连续实线，与 orca 一致）；false 则走字体字形，
    // JetBrains Mono 不满格 → 块内横向白缝（neeko 对照截图的差异根源，见 design D1）。
    return mountWebglAddon(
      term,
      new WebglAddonCtor({ customGlyphs: true }) as unknown as WebglAddonLike,
      onContextLoss,
      state,
    );
  } catch (err) {
    // 构造/激活失败（典型：WebglRenderer 构造期 getContext('webgl2') 返回 null、
    // shader 编译失败、linkifier 竞态）。此前静默 return null 是观测盲区
    // （design D7.6）：toast 只报 null，真实 throw 原因必须落到 console 才能定性。
    console.error('[renderer] WebglAddon construct/activate failed:', err);
    return null;
  }
}

/**
 * 清图集 + 强制重绘（design D3）：clearTextureAtlas 只失效图集，不保证重画；
 * xterm 的暂停渲染门（IntersectionObserver 未相交）会吞掉被动重绘 → stale 帧
 * 残留看起来仍像乱码。refresh 是 best-effort：抛错吞掉但 clear 已成功时
 * 仍返回 true（由调用方推进时间戳，避免下个边界重复清图集）。
 */
function clearAtlasAndRefresh(term: Terminal, addon: WebglAddonLike): boolean {
  try {
    addon.clearTextureAtlas?.();
  } catch {
    // 图集尚未初始化或 addon 已失效：返回 false，调用方不推进时间戳 → 下个边界重试
    return false;
  }
  try {
    term.refresh(0, term.rows - 1);
  } catch {
    // 暂停门/已 dispose 等：重绘尽力而为，不影响本次自愈记账
  }
  return true;
}

/**
 * WebGL 图集自愈（attach 路径）：DOM 移动（tab 切换 attach/detach）后纹理
 * 图集与旧画布失同步 → 字符错乱/中文断裂成方块。语义精确修复 = 失效图集
 * （下次绘制重栅格化）+ 强制整屏重绘（防 stale 帧残留），成本远低于重建 GL。
 *
 * 幂等安全：非 WebGL 终端无 addon 注册项 → 静默返回；抛错（图集未初始化）
 * 不推进时间戳 → 下个 attach 重试。
 *
 * 节流（30s 窗口）：高频 tab 切换的重复 clear 无实质收益；只约束「图集失效」，
 * 不约束 resumeWebglRenderer（重建渲染器，语义不同）。
 */
export function healWebglRenderer(term: Terminal): void {
  const addon = webglAddons.get(term)?.addon;
  if (!addon?.clearTextureAtlas) return;
  const meta = getOrCreateMeta(term);
  if (!shouldHealWebgl(meta.lastHealAt, Date.now())) return;
  // 成功自愈才推进节流时间戳；失败 → 下个 attach 重试
  if (clearAtlasAndRefresh(term, addon)) meta.lastHealAt = Date.now();
}

/**
 * P0-B 字体兜底 heal（design D4）：与 attach-heal 语义相同，但走独立
 * fontHealAt 节流戳 —— fonts.ready 落在 attach 30s 窗口内是常态（启动期
 * 常驻终端），共用戳会被吞掉，首帧锁死的 fallback 字形永远补不回来。
 */
function healWebglRendererForFontsReady(term: Terminal): void {
  const addon = webglAddons.get(term)?.addon;
  if (!addon?.clearTextureAtlas) return;
  const meta = getOrCreateMeta(term);
  if (!shouldHealWebgl(meta.fontHealAt, Date.now())) return;
  if (clearAtlasAndRefresh(term, addon)) meta.fontHealAt = Date.now();
}

/**
 * GL 上下文显式释放（对齐 orca disposeWebgl，design D4-5）：xterm 的
 * addon.dispose 只移除画布，Windows/ANGLE 下驱动上下文会滞留到 GC ——
 * 快速切 tab 极易撞上 Chromium 活跃上下文配额。loseContext + canvas
 * 清零令配额立即归还。读 addon 私有 _renderer，全程 try/catch，
 * 结构对不上（mock/未来版本）则跳过，不阻塞 suspend。
 */
function releaseGlContext(addon: WebglAddonLike): void {
  try {
    const internals = addon as unknown as {
      _renderer?: {
        _gl?: { getExtension?: (name: string) => { loseContext?: () => void } | null };
        _canvas?: { width: number; height: number };
      };
    };
    internals._renderer?._gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    const canvas = internals._renderer?._canvas;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch {
    // teardown 不得阻塞回退：静默，配额靠 dispose + GC 兜底
  }
}
/**
 * 取出并注销终端的 WebGL 注册：显式退订 onContextLoss（不再依赖
 * addon.dispose 的隐式清理，neeko-check W1）→ 释放 GL 上下文 →
 * dispose addon。幂等：无注册项 → 返回 null，调用方 no-op。
 */
function disposeRegistration(term: Terminal): WebglAddonLike | null {
  const reg = webglAddons.get(term);
  if (!reg) return null;
  webglAddons.delete(term);
  try {
    reg.unsubscribe?.();
  } catch {
    // 退订失败（罕见）：继续走 dispose 兜底清理
  }
  releaseGlContext(reg.addon);
  try {
    reg.addon.dispose();
  } catch {
    // addon dispose 的 linkifier 竞态：吞掉，注册表照常清除
  }
  return reg.addon;
}

/**
 * 终端 WebGL 上下文挂起（tab 切走 / 组件卸载 → TerminalViewBase cleanup）：
 * 释放 GPU 上下文配额（Chromium/WKWebView 上限约 8~16，多 tab 累积正是
 * context-loss 的系统性源头 —— suspend 是「防」而非「治」）。注销链路经
 * disposeRegistration 统一收口（退订 + 放配额 + dispose）；终端缓冲数据
 * 完好，下次可见经 resumeWebglRenderer 重建。
 *
 * 幂等安全：Canvas 计划终端 / 已 degrade 终端无 addon 注册项 → no-op。
 */
export function suspendWebglRenderer(term: Terminal): void {
  if (!disposeRegistration(term)) return;
  const meta = rendererMeta.get(term);
  if (meta) meta.suspended = true;
}

/**
 * 终端重新可见（tab 切回 → attach）时恢复 WebGL 渲染器：suspended 且
 * plan=webgl → 重新装载 WebglAddon 并重建 onContextLoss 恢复链；canvas 计划
 * / 未 suspend / 终端已 dispose → no-op（分别由 heal 路径或重建流程覆盖）。
 *
 * 竞态防护：resume 的 await import 命中 preloadRendererAddons 预热缓存 →
 * 微任务原子，cleanup 的 dispose（宏任务）无法插入 —— 结构性闭合（与
 * applyRenderer 同款设计）；装载前 isTerminalDisposed 守卫挡住重建竞态。
 *
 * 恢复计数：state 挂 RendererMeta，跨 suspend 存活 —— reloads/lastReloadAt
 * 不因 tab 切换清零，防「suspend 重置计数 → 无限重载」风暴放大器。
 *
 * 失败兜底：resume 失败（模块加载失败 / loadAddon 抛错）→ 显式降级 Canvas
 * （避免落回 xterm 默认 DOM renderer —— TUI 高频重绘下内存风暴的根源），
 * 真实能力边界必须打点可观测。
 */
export async function resumeWebglRenderer(term: Terminal): Promise<void> {
  const meta = rendererMeta.get(term);
  if (!meta || !meta.suspended) return;
  if (meta.plan !== 'webgl') return;
  if (isTerminalDisposed(term)) return;
  meta.suspended = false;
  const addon = await loadWebglRenderer(term, meta.state, createContextLossHandler());
  if (addon) return;
  meta.canvasFallback = true;
  reportFrontendError(
    RENDERER_EVENT_RESUME,
    new Error('WebGL renderer resume failed, falling back to canvas renderer'),
  );
  try {
    const { CanvasAddon } = await import('@xterm/addon-canvas');
    if (!isTerminalDisposed(term) && hasLinkifier(term)) term.loadAddon(new CanvasAddon());
  } catch (err) {
    // 双失败：下一 attach / onContextLoss 重新决策。design D7.6：真实 throw
    // 落 console（否则 webgl resume + canvas fallback 双双失败时完全不可见）。
    console.error('[renderer] resume canvas fallback failed:', err);
  }
}

/**
 * 在真实终端上执行一次「addon 重载」：经 disposeRegistration 统一注销旧
 * 注册（退订旧恢复链 + 放配额 + dispose），再装载新 WebglAddon —— 命中
 * preloadRendererAddons 的模块缓存 → 微任务原子，dispose 宏任务无法插入
 * 竞态窗口。返回新 addon；任一步失败静默返回 null（注册表已清，交由
 * 下一次事件决策）。
 */
async function reloadWebglAddon(
  term: Terminal,
  onContextLoss: WebglRecoveryHandler,
  state: WebglRecoveryState,
): Promise<WebglAddonLike | null> {
  disposeRegistration(term);
  const mod = await import('@xterm/addon-webgl').catch((err) => {
    console.error(withImportContext('@xterm/addon-webgl', err));
    return null;
  });
  if (!mod) return null;
  try {
    return mountWebglAddon(
      term,
      new mod.WebglAddon({ customGlyphs: true }) as unknown as WebglAddonLike,
      onContextLoss,
      state,
    );
  } catch (err) {
    // 构造/loadAddon 失败：注册表已清（design D6），交由下一次事件重新决策。
    // design D7.6：真实 throw 必须落 console，否则 context-loss 恢复链的失败不可定性。
    console.error('[renderer] WebglAddon reload failed:', err);
    webglAddons.delete(term);
    return null;
  }
}

/**
 * onContextLoss 恢复决策处理器工厂：从 applyRenderer 局部闭包提取为
 * 可复用工厂 —— suspend → resume 后新 addon 需重建订阅，而恢复计数
 * （reloads / lastReloadAt）必须继续累积在同一个 RendererMeta.state 上，
 * 否则每次 tab 切换都会「重置重载上限」→ 无限 reload 风暴。
 *
 * degrade 语义（借鉴 orca context-loss latch 的 P1 前置登记）：降级 Canvas
 * 时置 canvasFallback 标记并打点；本阶段 degrade 后不主动回 WebGL（保持
 * 现状），canvasFallback 供后续「可见性边界重试」决策消费。
 */
function createContextLossHandler(): WebglRecoveryHandler {
  return async (t) => {
    const meta = getOrCreateMeta(t);
    const action = planWebglRecovery(meta.state, Date.now());
    if (action.kind === 'degrade') {
      meta.canvasFallback = true;
      reportFrontendError(
        RENDERER_EVENT_RECOVERY,
        new Error('WebGL context lost, falling back to canvas renderer'),
      );
      // 失效的 WebGL 注册一并注销（退订 + 放配额 + dispose），否则 heal 会
      // 继续打在废 addon 上，且 suspend 会重复 dispose（见 degrade 清理测试）
      disposeRegistration(t);
      try {
        const { CanvasAddon } = await import('@xterm/addon-canvas');
        t.loadAddon(new CanvasAddon());
      } catch {
        // 降级失败：下一 onContextLoss 重新决策，静默
      }
      return null;
    }
    const next = await reloadWebglAddon(t, createContextLossHandler(), meta.state);
    if (next) {
      meta.state.reloads += 1;
      meta.state.lastReloadAt = Date.now();
    }
    return next;
  };
}

/**
 * 读取终端当前真实生效的渲染器类型（DOM / Canvas / WebGL）。
 *
 * 判定策略（design D7.1 + D7.5，压缩类名与 holder 包装双免疫）：
 * 1. 结构事实（预打包产物 setRenderer 实证）：
 *    `setRenderer(e) { this._renderer.value = e, ... }` —— `_renderService._renderer`
 *    是 **MutableDisposable holder**（类名压缩后即 "P"），真渲染器实例在 `.value` 上，
 *    必须先解包再嗅探（否则恒 unknown，实测 2026-09-03）。
 * 2. xterm 包自带 bundle 类名已压缩（单字母），以**特征属性嗅探**为主、类名正则为辅：
 *  - WebglRenderer：`_gl`（WebGL 上下文；注意 WebglRenderer 也有 _renderLayers，先判 _gl）
 *  - CanvasRenderer：`_renderLayers` / `_charAtlas`（addon-canvas bundle 实证）
 *  - DomRenderer：`_rowContainer` / `_helperContainer` / `_linkifier2`（xterm core 实证）
 *
 * 返回值：
 *  - 'webgl' / 'canvas' / 'dom'：特征属性命中的三态真相
 *  - 'unknown'：解包后特征全不命中（版本结构变迁，需人工复核）
 *  - 'untestable'：term._core._renderService 本身缺失（mock / 未完成 init），
 *    post-condition 检查跳过此值，避免把测试误判成 DOM。
 */
export function detectActiveRenderer(
  term: Terminal,
): 'webgl' | 'canvas' | 'dom' | 'unknown' | 'untestable' {
  try {
    if (isTerminalDisposed(term)) return 'unknown';
    const core = (term as unknown as { _core?: unknown })._core as
      | { _renderService?: { _renderer?: unknown } }
      | undefined;
    if (!core || !('_renderService' in core)) return 'untestable';
    const holder = core._renderService?._renderer as
      | { value?: unknown; constructor?: { name?: string } }
      | undefined;
    const r =
      holder && typeof holder === 'object' && 'value' in holder
        ? (holder.value as Record<string, unknown> | null | undefined)
        : (holder as Record<string, unknown> | null | undefined);
    if (!r) return 'dom';
    // 特征属性嗅探（对压缩类名免疫），顺序 webgl → canvas → dom
    if ('_gl' in r) return 'webgl';
    if ('_renderLayers' in r || '_charAtlas' in r) return 'canvas';
    if ('_rowContainer' in r || '_helperContainer' in r || '_linkifier2' in r) return 'dom';
    // 类名兜底（未压缩构建下才可能命中）
    const name = (r.constructor as { name?: string } | undefined)?.name ?? '';
    if (/Webgl/i.test(name)) return 'webgl';
    if (/Canvas/i.test(name)) return 'canvas';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 按确定性计划装载渲染器。调用时机为终端创建期；配合启动期预热，
 * 此处的 await import 恒为微任务原子。
 *
 * 不再有静默降级到 DOM（design D7）：
 *  - 任一分支抛错 → 拆 try/catch 显式打 console.error（含 plan + 阶段 + err），
 *    然后经 reportFrontendError 上报。本函数不再吞任何异常。
 *  - WebGL 路径：addon 构造 / loadAddon 失败 → 链式降级到 Canvas（探测可用），
 *    Canvas 也失败 → 报告并显式落到 DOM（这是真正的无能力边界，非静默降级）。
 *  - Canvas 路径：addon 加载失败 → 报告，**绝不静默落到 DOM** —— xterm 6 默认
 *    DOM renderer 在 TUI 高频重绘下内存爆炸（已知功能缺陷，与 CanvasAddon 设计
 *    注释对齐），落到 DOM 必须显式高声报错让用户感知。
 *  - post-load 一致性断言：loadAddon 后必须能在 term._core._renderService 上读
 *    到非 'dom' 的渲染器。否则判定为「loadAddon 假装成功但 xterm 实际未切换」，
 *    探测式回退到可用通道，避免悄悄在 DOM 上跑。
 *
 * WebGL 路径会注册 onContextLoss 恢复链：按 webglRecovery 策略重载 addon
 * （dispose → 重新 loadAddon，缓冲数据完好仅重建 GL 状态）或降级 Canvas，
 * 后者属真实能力边界，必须打点可观测。
 *
 * 渲染器选型与恢复计数登记到 RendererMeta（WeakMap）：供 suspend / resume
 * 跨生命周期读取（plan 决定 resume 是否重建 GL，state 跨 suspend 存活）。
 */
export async function applyRenderer(term: Terminal, gpuEnabled: boolean): Promise<void> {
  const plan = resolveRendererPlan(gpuEnabled);
  const meta = getOrCreateMeta(term);
  meta.plan = plan;
  meta.suspended = false;
  const devLog = (msg: string, extra?: unknown): void => {
    if (!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return;
    if (extra === undefined) console.warn(`[renderer] ${msg}`);
    else console.warn(`[renderer] ${msg}`, extra);
  };
  devLog(`applyRenderer start plan=${plan} gpuEnabled=${gpuEnabled}`);

  // 公共守卫：rebuild/race 中 term 已被 dispose 或 linkifier 未就绪 → 显式打点
  // 放弃，不静默。原 neeko-check W2 的语义保留（不弹 toast 噪音），但 dev 日志
  // 必须能看到这是「主动放弃」还是「加载失败」，二者不能混在一起。
  if (plan === 'webgl') {
    if (isTerminalDisposed(term) || !hasLinkifier(term)) {
      devLog(`webgl path aborted: term disposed or linkifier not ready`);
      return;
    }
    try {
      const addon = await loadWebglRenderer(term, meta.state, createContextLossHandler());
      if (!addon) {
        // loadWebglRenderer 内部 catch 把错吃掉并返回 null —— 这里抢救一次：
        // 强制降级 Canvas，绝不原地保留 DOM。
        reportFrontendError(
          RENDERER_EVENT_WEBGL_NULL,
          new Error('WebglAddon load returned null, attempting canvas fallback'),
        );
        await loadCanvasAddonWithErrorReport(term, 'webgl->canvas fallback');
      }
    } catch (err) {
      reportFrontendError(
        RENDERER_EVENT_WEBGL,
        err instanceof Error ? err : new Error(String(err)),
      );
      devLog(`webgl path threw`, err);
      try {
        await loadCanvasAddonWithErrorReport(term, 'webgl->canvas fallback after throw');
      } catch (err2) {
        reportFrontendError(
          RENDERER_EVENT_CANVAS,
          err2 instanceof Error ? err2 : new Error(String(err2)),
        );
        devLog('webgl + canvas both failed → terminal stays on DOM (LAST RESORT)', err2);
        // 这是真正的无能力边界：DOM 是最后兜底。**显式**打 console，不静默。
      }
    }
  } else {
    if (isTerminalDisposed(term) || !hasLinkifier(term)) {
      devLog(`canvas path aborted: term disposed or linkifier not ready`);
      return;
    }
    try {
      await loadCanvasAddonWithErrorReport(term, 'canvas plan');
    } catch (err) {
      reportFrontendError(
        RENDERER_EVENT_CANVAS,
        err instanceof Error ? err : new Error(String(err)),
      );
      devLog('canvas path threw → terminal stays on DOM (LAST RESORT)', err);
      // 真正的无能力边界：DOM 是最后兜底。**显式**打 console，不静默。
    }
  }

  // post-condition 一致性断言：loadAddon 后如果还停在 DOM，意味着 loadAddon
  // 假装成功但 xterm 没切。此时多走一遍显式 fallback，避免「看起来没事但 DOM 跑」。
  // 注意：`untestable` 表示 term 是测试 mock / 未完成 init，_core._renderService
  // 都还没注入 —— 不能误判为 DOM。
  const active = detectActiveRenderer(term);
  if (active === 'dom' || active === 'unknown') {
    devLog(`post-load active=${active} (plan=${plan}), trying emergency canvas path`);
    if (plan !== 'canvas') {
      try {
        await loadCanvasAddonWithErrorReport(term, 'post-load emergency fallback');
      } catch {
        // last resort
      }
    }
  }
  devLog(`applyRenderer done plan=${plan} active=${detectActiveRenderer(term)}`);
}

/**
 * Canvas 装载器：拆 try/catch 显式打点（不再让 applyRenderer 的外层 catch 把
 * CanvasAddon 的错当 WebGL 的错掩盖掉）。函数语义「成功/失败」绑到终端真实状态：
 * 构造 + loadAddon 都成功，但 DOM 是 active → 视为失败并抛错（post-condition），
 * 因为我们已经知道「DOM = TUI 内存风暴」，让它留在 DOM 是功能缺陷。
 */
async function loadCanvasAddonWithErrorReport(term: Terminal, phase: string): Promise<void> {
  let CanvasAddonCtor: new () => unknown;
  try {
    const mod = await import('@xterm/addon-canvas');
    if (typeof mod.CanvasAddon !== 'function') {
      throw new Error("export 'CanvasAddon' missing from @xterm/addon-canvas");
    }
    CanvasAddonCtor = mod.CanvasAddon as unknown as new () => unknown;
  } catch (err) {
    throw withImportContext('@xterm/addon-canvas', err);
  }
  if (isTerminalDisposed(term) || !hasLinkifier(term)) {
    throw new Error(`[${phase}] term disposed or linkifier missing`);
  }
  const addon = new CanvasAddonCtor();
  term.loadAddon(addon as Parameters<Terminal['loadAddon']>[0]);
  // post-load 一致性断言。`untestable`（mock 终端 / 未完成 init）跳过此断言
  // —— 不能让测试环境被误判为 DOM。
  const active = detectActiveRenderer(term);
  if (active === 'dom' || active === 'unknown') {
    throw new Error(`[${phase}] CanvasAddon loadAddon did not switch renderer (active=${active})`);
  }
}

// 字体栈唯一真相已收敛至 shared/utils/typography.ts（SSOT）。
// 此处保留兼容 re-export，避免既有调用方与单测的导入路径断裂。
export {
  MONO_DEFAULT as DEFAULT_FONT_FAMILY,
  buildMonoStack as buildFontFamily,
} from './typography';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const DARK_ANSI_COLORS: Partial<ITheme> = {
  black: '#000000',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

const LIGHT_ANSI_COLORS: Partial<ITheme> = {
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#4f5258',
  brightBlack: '#696c77',
  brightRed: '#e06c75',
  brightGreen: '#50a14f',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#000000',
};

export function buildTerminalTheme(): ITheme {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const isDark = isDarkTheme(theme);
  const bg = cssVar('--bg-secondary') || (isDark ? '#000000' : '#ffffff');
  // Mono 前景：优先 --mono-fg 角色 token（与编辑器共用），回退 ANSI soft white
  const monoFg = cssVar('--mono-fg');
  const monoFgDim = cssVar('--mono-fg-dim');
  const softFg =
    monoFg ||
    (isDark ? DARK_ANSI_COLORS.white : LIGHT_ANSI_COLORS.white) ||
    cssVar('--text-secondary') ||
    (isDark ? '#abb2bf' : '#4f5258');
  const dimFg =
    monoFgDim ||
    (isDark ? DARK_ANSI_COLORS.brightBlack : LIGHT_ANSI_COLORS.brightBlack) ||
    cssVar('--text-muted') ||
    (isDark ? '#5c6370' : '#696c77');

  // Sync terminal colors so Debug Console / other panes can match xterm exactly.
  document.documentElement.style.setProperty('--terminal-bg', bg);
  document.documentElement.style.setProperty('--terminal-fg', softFg);
  document.documentElement.style.setProperty('--terminal-fg-dim', dimFg);

  return {
    background: bg,
    // Use soft ANSI white so Task Console default text is grayish, not pure white.
    foreground: softFg,
    cursor: cssVar('--accent-blue') || '#ffffff',
    selectionBackground: cssVar('--terminal-selection') || '#333333',
    selectionForeground: softFg,
    // Theme xterm's overlay scrollbar with the same tokens as the app chrome
    // (base.css global scrollbars) so the Console panel matches other panels.
    scrollbarSliderBackground: cssVar('--bg-hover') || (isDark ? '#3e4451' : '#c9cdd4'),
    scrollbarSliderHoverBackground: cssVar('--text-muted') || (isDark ? '#5c6370' : '#9a9ea5'),
    scrollbarSliderActiveBackground: cssVar('--text-muted') || (isDark ? '#5c6370' : '#9a9ea5'),
    ...(isDark ? DARK_ANSI_COLORS : LIGHT_ANSI_COLORS),
  };
}
