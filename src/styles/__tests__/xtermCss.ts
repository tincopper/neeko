// @vitest-environment node
import { SCROLL_IDLE_CLASS } from '@/shared/utils/scrollAutoHide';

import { parseRules } from './cssRules';

/**
 * 终端滚动条 CSS 契约的**判据**（xterm.css）。
 *
 * 独立成非测试模块（同 `themeCss.ts` 的做法）：真实文件断言与反证用例走同一个函数，
 * 反证无法「自说自话地重算一遍判据」而假绿。
 *
 * 契约三条：
 * 1. 空闲态（`.scroll-idle`）滑块淡出 —— `opacity: 0`
 * 2. 极性：基础滑块规则**不得**默认隐藏（无类 = 可见，接线缺失时退回 xterm 原行为）
 * 3. 空闲态滚动条容器 `pointer-events: none`（透明 6px 不能吃掉终端最右列点击/选区）
 * 4. 基础滑块半透明（浮在已铺满的网格之上）
 */

/** 返回契约违规清单（空数组 = 合规）。 */
export function autohideViolations(css: string): string[] {
  const rules = parseRules(css);
  const violations: string[] = [];

  // ① 空闲态淡出：`.scroll-idle` 下的滑块必须 opacity: 0
  const hiddenWhenIdle = rules.some(
    (r) =>
      r.selector.includes(`.${SCROLL_IDLE_CLASS}`) &&
      r.selector.includes('.xterm-slider') &&
      /opacity\s*:\s*0(?!\d|\.)/.test(r.body),
  );
  if (!hiddenWhenIdle) {
    violations.push(`缺少 .${SCROLL_IDLE_CLASS} 下的淡出规则（滑块要 opacity: 0）`);
  }

  // ② 极性：基础滑块规则**不得**默认 opacity: 0 —— 否则接线缺失时滚动条彻底消失
  const defaultHidden = rules.some(
    (r) =>
      r.selector.includes('.xterm-slider') &&
      !r.selector.includes(SCROLL_IDLE_CLASS) &&
      !r.selector.includes(':hover') &&
      /opacity\s*:\s*0(?!\d|\.)/.test(r.body),
  );
  if (defaultHidden) {
    violations.push(`滑块不得默认隐藏：极性必须是「无类 = 可见」（失败安全）`);
  }

  // ③ 半透明：滑块浮在终端网格之上（网格已铺到右边缘），必须 0 < opacity < 1
  const baseSlider = rules.find(
    (r) =>
      r.selector.includes('.xterm-slider') &&
      !r.selector.includes(SCROLL_IDLE_CLASS) &&
      !r.selector.includes(':hover') &&
      !r.selector.includes('.xterm-active'),
  );
  const baseOpacity = baseSlider ? /opacity\s*:\s*([0-9.]+)/.exec(baseSlider.body) : null;
  const opacityValue = baseOpacity ? Number.parseFloat(baseOpacity[1]) : NaN;
  if (!(opacityValue > 0 && opacityValue < 1)) {
    violations.push(
      `滑块必须半透明（基础规则 opacity 取 0~1 之间的小数），实际: ${
        baseOpacity ? baseOpacity[1] : '未声明'
      }`,
    );
  }

  // ④ 隐藏态不拦指针：终端最右 6px 不能被透明滑块吃掉点击/选区
  const pointerGated = rules.some(
    (r) =>
      r.selector.includes(`.${SCROLL_IDLE_CLASS}`) &&
      r.selector.includes('.xterm-scrollbar') &&
      /pointer-events\s*:\s*none/.test(r.body),
  );
  if (!pointerGated) {
    violations.push(`空闲态滚动条必须 pointer-events: none，否则透明滑块会挡住终端最右 6px`);
  }

  return violations;
}
