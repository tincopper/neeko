// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `@xterm/addon-fit` 补丁守卫（**依赖契约**）。
 *
 * ## 为什么需要
 *
 * `FitAddon.proposeDimensions()` 写死：
 * `scrollback === 0 ? 0 : (options.overviewRuler?.width || 14)`。
 * xterm 6 已移除 `overviewRuler` 选项（见 `shared/utils/terminal.ts`），于是该式**恒取 14**
 * —— 终端网格右侧凭空少 14px，表现为「右边留白比左边宽」。
 *
 * 修复落在 `patches/@xterm__addon-fit@0.11.0.patch`（`pnpm-workspace.yaml` 的
 * `patchedDependencies`，无版本键 → 升级 addon 时若打不上会硬失败）。
 *
 * 这条测试守的是**补丁真的生效**：pnpm 只保证「patch 应用成功」，不保证它改的常量
 * 还是唯一的那一处；有人 `pnpm add` 绕过 patch、或上游改了写法，症状都会静默回归。
 */

const ADDON_FILES = [
  'node_modules/@xterm/addon-fit/lib/addon-fit.mjs',
  'node_modules/@xterm/addon-fit/lib/addon-fit.js',
];

const repoRoot = resolve(__dirname, '../../../..');

/** 返回违规清单（空数组 = 补丁生效）。抽成纯函数便于反证。 */
export function fitPatchViolations(read: (path: string) => string | null): string[] {
  const violations: string[] = [];
  for (const path of ADDON_FILES) {
    const source = read(path);
    if (source === null) {
      violations.push(`${path} 不存在（依赖未安装？）`);
      continue;
    }
    if (source.includes('overviewRuler?.width||14')) {
      violations.push(`${path} 仍保留 14px overview-ruler 预留（补丁未生效）`);
    } else if (!source.includes('overviewRuler?.width||0')) {
      violations.push(`${path} 未见补丁后的默认值 0（上游实现已变，需重打补丁）`);
    }
  }
  return violations;
}

describe('@xterm/addon-fit 补丁（终端右侧 14px 幻影）', () => {
  it('两份产物都已去掉 14px 预留', () => {
    const violations = fitPatchViolations((path) => {
      const abs = resolve(repoRoot, path);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    });
    expect(violations).toEqual([]);
  });

  it('反证：未打补丁的上游产物会被判违规', () => {
    const upstream =
      'const t=0===this._terminal.options.scrollback?0:this._terminal.options.overviewRuler?.width||14;';
    const violations = fitPatchViolations(() => upstream);
    expect(violations).toHaveLength(ADDON_FILES.length);
    expect(violations.join('|')).toContain('补丁未生效');
  });

  it('反证：上游改写实现（找不到常量）会被判违规', () => {
    const rewritten = 'const overview = 0;';
    const violations = fitPatchViolations(() => rewritten);
    expect(violations.join('|')).toContain('需重打补丁');
  });
});
