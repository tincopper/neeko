import type { QuickFixMenuItem, QuickFixMenuSection } from '../api/codeAction';

/**
 * quickfix 菜单的键盘导航（**纯函数**，两个渲染方共用）。
 *
 * 与定位计算同理：菜单有 React（Problems 行内）与原生 DOM（编辑器内）两处宿主，
 * 高亮移动的规则只能有一份，否则两端手感必然漂移。
 *
 * 语义选择：**跨组连续移动、跳过置灰项、两端不回绕**（到顶/到底停住）。回绕会让
 * 用户按住方向键时"跳回去"，对只有两三项的 quickfix 菜单反而更难定位。
 */

/** 摊平所有分组的条目（含置灰项）—— 键盘下标以此为准，渲染两侧都用同一个下标。 */
export function flattenMenuItems(sections: QuickFixMenuSection[]): QuickFixMenuItem[] {
  return sections.flatMap((section) => section.items);
}

/** 首个可执行项的下标；全为置灰时返回 -1（此时无高亮）。 */
export function firstEnabledIndex(items: QuickFixMenuItem[]): number {
  return items.findIndex((item) => !item.disabledHint);
}

/**
 * 从 `from` 起步进 `delta`（±1），跨过置灰项；到达边界停住。
 *
 * `from` 为 -1（当前无高亮）时：向下取首个可执行项，向上取最后一个可执行项。
 */
export function stepEnabledIndex(items: QuickFixMenuItem[], from: number, delta: number): number {
  if (items.length === 0) return -1;

  if (from < 0) {
    if (delta >= 0) return firstEnabledIndex(items);
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (!items[i].disabledHint) return i;
    }
    return -1;
  }

  let cursor = from;
  for (;;) {
    const next = cursor + delta;
    // 到边界停住，不回绕；且**停在原位**而不是退到跨过的置灰项上（否则高亮会落在不可点项）
    if (next < 0 || next >= items.length) return from;
    if (!items[next].disabledHint) return next;
    cursor = next;
  }
}
