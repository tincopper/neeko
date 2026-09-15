import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * 分层护栏：可运行 gutter 的四个模块**依赖单向**，防止再次退化成「单文件 442 行混 8 个关注点」。
 *
 * ```
 * runTarget.ts (L0 契约/目标身份)   runLspOverlay.ts (L0 tier① 状态定义)
 *                  ↘                ↙
 *                   runMarkers.ts  (L1 文档 → markers + 图标外观)
 *                          ↓
 *                   runContribution.ts (L2 装配 + 公开 API)
 * ```
 *
 * 之所以把 tier ① 的状态定义单独放 L0：它被**读方**（markers 构建 payload）与**写方**
 * （异步 loader）同时使用 —— 放进任一方都会形成 `markers ↔ contribution` 循环。叶子层
 * 保证依赖无环。线条数上限只作**参考提示**（超限往往是职责又混回来了的信号），不当硬门禁。
 */
const GUTTER = 'src/features/editor/gutter';
const RUNNER = 'src/features/runner';
const read = (name: string): string => readFileSync(`${GUTTER}/${name}`, 'utf8');
const readRunner = (name: string): string => readFileSync(`${RUNNER}/${name}`, 'utf8');

/** 某模块是否 import 了更高层的模块。 */
const importsUp = (source: string, higher: readonly string[]): boolean =>
  higher.some((dep) => new RegExp(`from '\\./${dep}'`).test(source));

const MARKERS = 'runMarkers' as const;
const CONTRIBUTION = 'runContribution' as const;

describe('分层护栏：gutter 四模块依赖单向', () => {
  it('L0 叶子（runLspOverlay）不依赖任何上层', () => {
    expect(importsUp(read('runLspOverlay.ts'), [MARKERS, CONTRIBUTION])).toBe(false);
    // RunTarget 已迁 runner 根（运行目标身份属 runner 域），L0 叶子语义保持：
    // 它只依赖 runner 内部下层（runnables/syntax/utils），不依赖 gutter 上层。
    expect(importsUp(readRunner('runTarget.ts'), ['gutter'])).toBe(false);
  });

  it('L1 markers 不依赖 L2 装配层', () => {
    expect(importsUp(read('runMarkers.ts'), [CONTRIBUTION])).toBe(false);
  });

  it('L2 装配层依赖下层（正向），且公开 API 仍在装配层导出', () => {
    const contribution = read('runContribution.ts');
    expect(importsUp(contribution, [MARKERS, 'runLspOverlay'])).toBe(true);
    for (const api of [
      'createRunCodelensCore',
      'createRunContribution',
      'runLinesOf',
      'runAtLine',
    ]) {
      expect(contribution).toContain(`export function ${api}`);
    }
  });

  it('目标身份（RunTarget 等）由 runner/runTarget 持有，装配层不再重复定义', () => {
    const target = readRunner('runTarget.ts');
    expect(target).toMatch(/export type RunTarget\b/);
    expect(target).toMatch(/export function targetLine\b/);
    expect(target).toMatch(/export function targetLang\b/);
    expect(read('runContribution.ts')).not.toMatch(/export type RunTarget\b/);
  });
});
