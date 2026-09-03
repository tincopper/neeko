import { describe, expect, it } from 'vitest';

import {
  WEBGL_HEAL_THROTTLE_MS,
  WEBGL_RELOAD_COOLDOWN_MS,
  WEBGL_RELOAD_MAX,
  planWebglRecovery,
  shouldHealWebgl,
  type WebglRecoveryState,
} from '../webglRecovery';

/**
 * WebGL 渲染层恢复策略（纯函数）测试。
 *
 * 背景：WKWebView 会静默失效化/逐出 WebGL 上下文（配额有限、隐藏画布优先），
 * xterm WebglAddon 的 onContextLoss 在 3s 未恢复后交给宿主处理。策略决定：
 * - reload：dispose 失效 addon，装载新 WebglAddon（同终端，保持缓存语义）；
 * - degrade：dispose 后降级 Canvas 渲染器（真实能力边界，调用方打点）。
 *
 * 冷却语义：重建后很快又丢（冷却窗口内）说明是环境性失败（GPU 挂死/配额
 * 持续超限），立即降级；冷却窗口外的丢失仍可尝试 reload，直到次数上限。
 */

function state(partial: Partial<WebglRecoveryState> = {}): WebglRecoveryState {
  return { reloads: 0, lastReloadAt: 0, ...partial };
}

describe('planWebglRecovery', () => {
  it('首次上下文丢失（从未 reload）→ reload（不受冷却约束）', () => {
    const action = planWebglRecovery(state(), 1_000_000);
    expect(action.kind).toBe('reload');
  });

  it('冷却窗口内再次丢失 → degrade（环境性失败，防重建风暴）', () => {
    const s = state({ reloads: 1, lastReloadAt: 1_000_000 });
    const action = planWebglRecovery(s, 1_000_000 + WEBGL_RELOAD_COOLDOWN_MS - 1);
    expect(action.kind).toBe('degrade');
  });

  it('冷却窗口过后再次丢失且未达上限 → reload', () => {
    const s = state({ reloads: 1, lastReloadAt: 1_000_000 });
    const action = planWebglRecovery(s, 1_000_000 + WEBGL_RELOAD_COOLDOWN_MS);
    expect(action.kind).toBe('reload');
  });

  it('达到 reload 次数上限 → degrade（即使冷却窗口已过）', () => {
    const s = state({ reloads: WEBGL_RELOAD_MAX, lastReloadAt: 0 });
    const action = planWebglRecovery(s, 10_000_000_000);
    expect(action.kind).toBe('degrade');
  });
});

describe('shouldHealWebgl', () => {
  it('从未 heal 过 → true', () => {
    expect(shouldHealWebgl(0, 1_000_000)).toBe(true);
  });

  it('节流窗口内 → false', () => {
    const lastHealAt = 1_000_000;
    expect(shouldHealWebgl(lastHealAt, lastHealAt + WEBGL_HEAL_THROTTLE_MS - 1)).toBe(false);
  });

  it('节流窗口过后 → true', () => {
    const lastHealAt = 1_000_000;
    expect(shouldHealWebgl(lastHealAt, lastHealAt + WEBGL_HEAL_THROTTLE_MS)).toBe(true);
  });
});
