import { describe, expect, it } from 'vitest';

import type { RunTarget } from '../../runTarget';
import { overlayKey } from '../index';

/**
 * `overlayKey` 契约（Neeko Check F1 回归）：**键规则由语言模块给**，通用层只按目标语言取用。
 *
 * 背景：此前同一概念有两份实现（一份以 `(lang, overlay)` 为入参、且**全仓无调用点**）。重复实现
 * 一旦漂移，会让 gutter marker 的 `eq` 失效 —— 要么无谓重建 DOM（性能），要么该重建时不重建
 * （状态不刷新）。本用例钉住「唯一实现 + 未命中时语义安全」。
 */
const rustTarget = (overlay?: unknown): RunTarget => ({
  kind: 'test',
  testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
  ...(overlay === undefined ? {} : { overlay }),
});

describe('overlayKey — 键规则归语言，通用层不认识语言', () => {
  it('无 overlay → 空串（未命中 tier ① 的行不参与比较）', () => {
    expect(overlayKey(rustTarget())).toBe('');
  });

  it('Rust：label / cargo 参数 / 可执行参数相同 → 同键（避免无谓重建）', () => {
    const overlay = {
      label: 'cargo test -p api',
      kind: 'cargo',
      args: { cargoArgs: ['test', '--package', 'api'], executableArgs: ['x', '--exact'] },
    };
    expect(overlayKey(rustTarget(overlay))).toBe(overlayKey(rustTarget({ ...overlay })));
  });

  it('Rust：可执行参数变化 → 键变化（状态必须重建）', () => {
    const base = {
      label: 'l',
      kind: 'cargo',
      args: { cargoArgs: ['test'], executableArgs: ['a'] },
    };
    expect(overlayKey(rustTarget(base))).not.toBe(
      overlayKey(rustTarget({ ...base, args: { cargoArgs: ['test'], executableArgs: ['b'] } })),
    );
  });

  it('语言未声明 overlayKey（Go/TS）→ 空串，不抛错', () => {
    expect(
      overlayKey({ kind: 'test', testCase: { name: 't', line: 1, lang: 'go' }, overlay: {} }),
    ).toBe('');
    expect(overlayKey({ kind: 'main', entry: { line: 1, language: 'go' }, overlay: {} })).toBe('');
  });
});
