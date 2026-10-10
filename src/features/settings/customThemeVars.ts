/**
 * 自定义主题 CSS 变量的应用 / 清理（从 `useAppConfig` 抽出的职责单一模块）。
 *
 * 自定义主题以「CSS 变量集合」形式下发；应用新主题前必须清理上一次应用的变量，
 * 否则主题切换会残留旧变量（尤其新主题未覆盖的键）。模块级 `_previousCustomVars`
 * 记录上一次实际写入的键集合。
 */

const CUSTOM_CSS_VARS = [
  'bg-primary',
  'bg-secondary',
  'bg-tertiary',
  'bg-hover',
  'bg-selected',
  'bg-gradient-start',
  'bg-gradient-end',
  'text-primary',
  'text-secondary',
  'text-muted',
  'border-color',
  'terminal-selection',
  'titlebar-gradient-start',
  'accent-blue',
  'accent-blue-rgb',
  'accent-green',
  'accent-yellow',
  'accent-red',
  'text-on-accent',
  'status-idle',
  'status-running',
  'status-failed',
  'diff-added',
  'diff-removed',
  'diff-added-text',
  'diff-removed-text',
];

let _previousCustomVars: string[] | null = null;

/** 应用一组自定义 CSS 变量（先清理上一次应用的键）。 */
export function applyCustomCssVars(variables: Record<string, string>) {
  if (_previousCustomVars) {
    for (const name of _previousCustomVars) {
      document.documentElement.style.removeProperty(`--${name}`);
    }
  }
  const applied: string[] = [];
  for (const name of CUSTOM_CSS_VARS) {
    const val = variables[name];
    if (val !== undefined) {
      document.documentElement.style.setProperty(`--${name}`, val);
      applied.push(name);
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
