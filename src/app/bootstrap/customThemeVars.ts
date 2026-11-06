/**
 * 自定义主题 CSS 变量的应用 / 清理 —— `configProjection` 的 DOM 写助手。
 *
 * 归属理由：本模块唯一的读者是「config → DOM」投影，故与投影同目录。它只做一件事
 * （把变量表写进 `documentElement`），不判断主题是否应该应用 —— 那个判据在投影里。
 *
 * 自定义主题以「CSS 变量集合」形式下发；应用新主题前必须清理上一次应用的变量，
 * 否则主题切换会残留旧变量（尤其新主题未覆盖的键）。模块级 `_previousCustomVars`
 * 记录上一次实际写入的键集合。
 *
 * ## 可覆盖清单来自契约，不在此处维护
 *
 * 早先这里有一份 31 项的硬编码白名单，而主题块有 59 个变量 —— 缺口是
 * **28 个**：全部 19 个 `--cm-*` 语法色、`--mono-fg`、`--switch-track`、
 * `--border-subtle`、3 个 `-rgb` 变体。用户做自定义主题后，编辑器语法高亮、
 * 终端前景色、Switch 轨道、弱分割线全部无法调整，且没有任何提示。
 *
 * 现在清单唯一来源是 `shared/utils/themeVariables.ts`，与主题块由单测强制对齐。
 */

import { CUSTOM_THEME_OVERRIDABLE } from '@/shared/utils/themeVariables';

let _previousCustomVars: string[] | null = null;

/** 应用一组自定义 CSS 变量（先清理上一次应用的键）。 */
export function applyCustomCssVars(variables: Record<string, string>) {
  if (_previousCustomVars) {
    for (const name of _previousCustomVars) {
      document.documentElement.style.removeProperty(`--${name}`);
    }
  }
  const applied: string[] = [];
  for (const token of CUSTOM_THEME_OVERRIDABLE) {
    // 契约里的每一项都带 `--` 前缀（`themeVariables.test.ts` 强制），
    // 而自定义主题下发的键名不带前缀，故此处必然去掉 2 个字符。
    const bare = token.slice(2);
    const val = variables[bare];
    if (val !== undefined) {
      document.documentElement.style.setProperty(`--${bare}`, val);
      applied.push(bare);
    }
  }
  _previousCustomVars = applied;
}

/** 清理当前应用的自定义 CSS 变量（切回内置主题时调用）。 */
export function clearCustomCssVars() {
  if (_previousCustomVars) {
    for (const name of _previousCustomVars) {
      document.documentElement.style.removeProperty(`--${name}`);
    }
    _previousCustomVars = null;
  }
}
