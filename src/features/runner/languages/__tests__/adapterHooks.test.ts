import { describe, expect, it } from 'vitest';

import { javaConsoleInvariant } from '../java/runtime';
import { adapterHookFor } from '../registry';

/**
 * 会话生命周期钩子的 characterization 测试（方案 B 阶段 4）。
 *
 * 这些判定原先硬编码在通用 `debugStore` 里（`config.type === 'go' | 'java'` 三语言文案分支 +
 * `javaBackendLabel === 'jdtls'` 零命中终止），**当时无任何测试覆盖**。迁到语言模块前先钉住
 * 行为，避免搬迁时静默改变：
 * 1. adapter 文案/门控按 DAP `type` 取（未登记 type → `null`，调用方走通用兜底文案）；
 * 2. 「0 用例」不变式只在 JDTLS 后端成立、且同一会话只报一次。
 */
describe('adapterHookFor — DAP type → 语言模块', () => {
  it('java / go 直连；lldb 与 codelldb 都归 Rust', () => {
    expect(adapterHookFor('java')?.id).toBe('java');
    expect(adapterHookFor('go')?.id).toBe('go');
    expect(adapterHookFor('lldb')?.id).toBe('rust');
    expect(adapterHookFor('codelldb')?.id).toBe('rust');
  });

  it('未登记的 type → null（调用方走通用兜底，不误报语言指引）', () => {
    expect(adapterHookFor('custom-adapter')).toBeNull();
    expect(adapterHookFor('')).toBeNull();
  });

  it('每门语言都提供 adapter 安装指引（文案非空且各不相同）', () => {
    const hints = (['java', 'go', 'lldb'] as const).map((t) =>
      adapterHookFor(t)?.debugHooks?.adapterHint(),
    );
    expect(hints.every((h) => typeof h === 'string' && h.length > 0)).toBe(true);
    expect(new Set(hints).size).toBe(3);
  });

  it('仅 Java 声明 adapter 门控跳过（JDTLS 后端不需要 host jar）', () => {
    expect(adapterHookFor('java')?.debugHooks?.skipAdapterGate).toBeTypeOf('function');
    expect(adapterHookFor('go')?.debugHooks?.skipAdapterGate).toBeUndefined();
    expect(adapterHookFor('lldb')?.debugHooks?.skipAdapterGate).toBeUndefined();
  });
});

describe('javaConsoleInvariant — Console Launcher「0 用例」不变式', () => {
  const zeroSummaryLine = 'Thanks for using JUnit! Support its maintenance by becoming a sponsor!';

  it('非 JDTLS 后端 → 不干预（host 路径有自己的失败呈现）', () => {
    expect(
      javaConsoleInvariant('0 tests found', { backendLabel: 'host', alreadyReported: false }),
    ).toBeNull();
    expect(
      javaConsoleInvariant('0 tests found', { backendLabel: null, alreadyReported: false }),
    ).toBeNull();
  });

  it('JDTLS 后端 + 已报过 → 不再重复（一次语义由闩锁保证）', () => {
    expect(
      javaConsoleInvariant('0 tests found', { backendLabel: 'jdtls', alreadyReported: true }),
    ).toBeNull();
  });

  it('JDTLS 后端 + 非零命中汇总行 → null（普通输出不触发终止）', () => {
    expect(
      javaConsoleInvariant('2 tests found', { backendLabel: 'jdtls', alreadyReported: false }),
    ).toBeNull();
    // 该行本身是 Console Launcher 的常规文案（不含「0 tests」汇总），不得误判。
    expect(
      javaConsoleInvariant(zeroSummaryLine, { backendLabel: 'jdtls', alreadyReported: false }),
    ).toBeNull();
  });

  it('JDTLS 后端 + 命中汇总行 → 终止会话并给出可自助的原因', () => {
    const verdict = javaConsoleInvariant('[         0 tests found          ]', {
      backendLabel: 'jdtls',
      alreadyReported: false,
    });
    expect(verdict?.stop).toBe(true);
    expect(verdict?.message).toContain('No tests were discovered for the requested selector');
  });
});
