import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 主题 token 完整性守卫。
 *
 * 背景：新增 `--accent-brick`（untracked 文件状态色）时只补了 classic-dark /
 * one-dark-pro / claude 三个主题块，漏掉默认 dark / light —— CSS 变量在该主题下
 * 未定义时 `color: var(--x)` 回退为继承色，表现为「颜色静默失效」（2026-08-28）。
 * 本测试防止同类遗漏：新增 accent token 时必须覆盖全部主题块。
 */
describe('theme token integrity', () => {
  const css = readFileSync(resolve(__dirname, '../theme.css'), 'utf8');

  /** 提取每个顶层 `:root ... { ... }` 主题块内定义的 CSS 自定义属性名 */
  function extractThemeVars(cssText: string): Map<string, Set<string>> {
    const themes = new Map<string, Set<string>>();
    const blockRe = /(^:root[^{]*)\{([^}]*)\}/gm;
    for (const match of cssText.matchAll(blockRe)) {
      const selector = (match[1] ?? '').replace(/\s+/g, ' ').trim();
      const body = match[2] ?? '';
      const vars = new Set<string>();
      for (const varMatch of body.matchAll(/--[\w-]+(?=\s*:)/g)) {
        vars.add(varMatch[0]);
      }
      themes.set(selector, vars);
    }
    return themes;
  }

  const themes = extractThemeVars(css);

  it('parses theme blocks from theme.css', () => {
    // 健全性：正则确实捕获到了主题块（防正则失配导致测试空转）
    expect(themes.size).toBeGreaterThanOrEqual(5);
  });

  it('defines --accent-brick in every theme block that carries an accent palette', () => {
    // 只校验承载 accent 色板的块（:root 基础块只有字体/终端兜底，无 accent，天然排除）
    const accentBlocks = [...themes.entries()].filter(([, vars]) => {
      let accentCount = 0;
      for (const v of vars) if (v.startsWith('--accent-')) accentCount += 1;
      return accentCount >= 3;
    });
    expect(accentBlocks.length).toBeGreaterThanOrEqual(5);

    const missing = accentBlocks
      .filter(([, vars]) => !vars.has('--accent-brick'))
      .map(([selector]) => `${selector} 缺少 --accent-brick`);
    expect(missing).toEqual([]);
  });
});
