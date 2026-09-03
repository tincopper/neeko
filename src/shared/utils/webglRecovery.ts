/**
 * WebGL 渲染层恢复策略（纯决策，无副作用）。
 *
 * 背景：WKWebView 的 WebGL 上下文配额有限（约 8~16 个），超限时会静默逐出
 * 最旧上下文（隐藏画布优先）。xterm WebglAddon 在上下文丢失且 3s 未恢复后
 * 通过 onContextLoss 交给宿主处理 —— 决策本模块承担：
 *
 * - reload：dispose 失效 addon，装载新 WebglAddon（终端缓冲完好，仅重建 GL 状态）；
 * - degrade：dispose 后降级 Canvas 渲染器（真实能力边界，调用方必须打点）。
 *
 * 冷却语义：重载后冷却窗口内再次丢失 = 环境性失败（GPU 挂死 / 配额持续
 * 超限），立即降级，防止「重载 → 再丢 → 再重载」风暴；窗口外的丢失仍可
 * 重载，直到次数上限。参数经 terminal.ts 编排层消费，此处只做可测纯函数。
 */

/** 同一终端实例允许的 addon 重载次数上限；超过即降级 Canvas。 */
export const WEBGL_RELOAD_MAX = 2;

/** 重载冷却窗口：窗口内再次丢失视为环境性失败，直接降级。 */
export const WEBGL_RELOAD_COOLDOWN_MS = 30_000;

/**
 * 重新可见自愈（clearTextureAtlas + 整屏重绘）的节流窗口。
 * 终端 tab 切换会高频触发 attach，无需每次都清图集重栅格化字形。
 */
export const WEBGL_HEAL_THROTTLE_MS = 30_000;

/** onContextLoss 恢复决策的输入状态（由编排层持有与更新）。 */
export interface WebglRecoveryState {
  /** 已成功的 addon 重载次数。 */
  reloads: number;
  /** 最近一次成功重载的时间戳（`Date.now()`，0 = 从未）。 */
  lastReloadAt: number;
}

export type WebglRecoveryAction = { kind: 'reload' } | { kind: 'degrade' };

/**
 * 上下文丢失后的恢复决策：达到重载上限或冷却窗口内再次丢失 → degrade；
 * 其余（含首次丢失，从未重载不受冷却约束）→ reload。
 */
export function planWebglRecovery(state: WebglRecoveryState, now: number): WebglRecoveryAction {
  if (state.reloads >= WEBGL_RELOAD_MAX) {
    return { kind: 'degrade' };
  }
  if (state.reloads > 0 && now - state.lastReloadAt < WEBGL_RELOAD_COOLDOWN_MS) {
    return { kind: 'degrade' };
  }
  return { kind: 'reload' };
}

/** 重新可见自愈的节流判定：从未自愈过恒放行；否则距上次自愈须满节流窗口。 */
export function shouldHealWebgl(lastHealAt: number, now: number): boolean {
  if (lastHealAt === 0) return true;
  return now - lastHealAt >= WEBGL_HEAL_THROTTLE_MS;
}
