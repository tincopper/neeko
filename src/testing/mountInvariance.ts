import { expect } from 'vitest';

/**
 * 断言「挂载一个组件不改写全局 DOM 状态」。
 *
 * 回归背景：`ViewSkillDialog`（`open=false` 也挂载）曾误调 config owner hook，mount 时
 * 把 `data-theme` 重置成 dark，再异步改回用户主题 —— 整窗闪黑。组件挂载必须是
 * 对全局状态**观测纯**的；应用级写入只能由 `bootstrap/configProjection` 的唯一投影点做。
 *
 * 覆盖范围：`documentElement` 的 `data-theme` 与内联 `style`（自定义主题的 CSS 变量落在
 * 后者）。其它全局面（`body` class、localStorage、事件订阅）不在本断言内，需要时单独断言。
 *
 * 用法：`expectNoGlobalSideEffectsOnMount(() => render(<X />))`。
 */
export function expectNoGlobalSideEffectsOnMount(render: () => void): void {
  const root = document.documentElement;
  const themeBefore = root.getAttribute('data-theme');
  const styleBefore = root.getAttribute('style');
  render();
  expect(root.getAttribute('data-theme')).toBe(themeBefore);
  expect(root.getAttribute('style')).toBe(styleBefore);
}
