/**
 * 变更高亮的样式判据（非测试模块）。
 *
 * ## 契约（第一性原理）
 *
 * Diff 的**必需信息**是「哪些行变了 + 变成什么」。行级底色 + 语法高亮 + 行号已完整承载；
 * 行内再给「变更片段」上一层底块属于**冗余信息**，代价却有三份：
 *
 * 1. 盖掉语法色 —— 片段底色优先级高于 hljs 着色，读者先看见底块再看见代码；
 * 2. 长行碎成色带 —— 一次改动跨越多个 token 时，行内出现若干不连续色块；
 * 3. 破坏列对齐 —— 底块通常带 `padding`，而代码格是 `white-space: pre`，片段一加内边距整行错位。
 *
 * 所以两个渲染面（编辑器 `features/editor/git-change`、Diff 面板 `features/git/components/diff`）
 * 共用同一条口径：**行级底色是唯一的「变了」标记，行内不再叠底块**。
 *
 * ## 为什么判据是纯函数
 *
 * 与 `inlineCodeCss.ts` / `xtermCss.ts` 同一纪律（`src/styles/README.md`）：真实文件断言与
 * 反证用例必须走同一个函数，否则反证会自己重算判据而假绿。
 *
 * ## 判据只读「选择器」，不读注释
 *
 * 两个 CSS 文件里都有一句解释「为什么不加行内底块」的注释，注释里会提到被禁的类名 ——
 * `parseRules` 已剥注释，因此解释性文字不会把自己判成违规（这正是 `stripComments` 存在的理由）。
 */

import { type CssRule, declarationsOf, parseRules } from './cssRules';

/** 一个渲染面的样式契约 */
export interface ChangeHighlightSurface {
  /** 报错定位用（相对 `src/styles/`） */
  file: string;
  /** 行级底色选择器：必须存在，且必须声明 background */
  lineSelectors: readonly string[];
}

/**
 * 契约覆盖的渲染面。
 *
 * 编辑器侧选择器带 `.cm-editor` 前缀（CodeMirror 注入样式无 layer，靠前缀提高特异度）；
 * Diff 面板侧是 `.split-cell`（并排）/ `.bg-diff-*`（统一），这里钉住并排的两个底色格。
 */
export const CHANGE_HIGHLIGHT_SURFACES: readonly ChangeHighlightSurface[] = [
  {
    file: 'components/editor.css',
    lineSelectors: ['.cm-editor .cm-git-line-added', '.cm-editor .cm-git-line-modified'],
  },
  {
    file: 'components/diff.css',
    lineSelectors: ['.split-cell.added', '.split-cell.removed'],
  },
];

/**
 * 被契约废止的行内底块类名。
 *
 * - `cm-git-word` —— 编辑器词级 `Decoration.mark`（行背景之外的片段底色）；
 * - `word-diff-added` / `word-diff-removed` —— Diff 面板 `dangerouslySetInnerHTML` 里的片段 span。
 *
 * 它们不是「保留待用」，而是**删掉的通道**：命中选择器即违规。
 */
export const FORBIDDEN_INLINE_CLASSES = [
  'cm-git-word',
  'word-diff-added',
  'word-diff-removed',
] as const;

/** 选择器是否以类名 `cls` 的形式出现（`.cm-git-word` / `.cm-git-word.x`，但不是 `.cm-git-wordish`） */
function usesClass(rule: CssRule, cls: string): boolean {
  const re = new RegExp(`\\.${cls}(?![\\w-])`);
  return rule.selectors.some((selector) => re.test(selector));
}

/**
 * 会被挂到 CodeMirror `.cm-line` 元素上的行级底色类名。
 *
 * 新增一条「整行底色」时把它登记进来，否则下面的透明判据对它空转。
 */
export const LINE_BACKGROUND_CLASSES = [
  'cm-git-line-added',
  'cm-git-line-modified',
  'cm-nav-flash-line',
] as const;

/** `background` 值是否透出下层（即能为选中块留出通道） */
function isTranslucentBackground(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'none') return true;
  // 与 transparent 混色（`color-mix(…, transparent)`）是本仓库唯一推荐形态
  if (/\btransparent\b/.test(v)) return true;

  const alphaOf = (raw: string): number =>
    raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);

  // rgba(r,g,b,α) / hsla(h,s%,l%,α)；triplet 写成 var(--x-rgb) 时末段仍是数值 α。
  // 贪婪取到最后一个 `)`：`rgba(var(--accent-blue-rgb), 0.28)` 的内层括号不能截断参数表。
  const fn = v.match(/\b(?:rgba|hsla)\(([\s\S]*)\)/);
  if (fn) {
    const parts = fn[1].split(/[,/]/).map((p) => p.trim());
    const alpha = parts[parts.length - 1];
    if (parts.length >= 2 && alpha && Number.isFinite(alphaOf(alpha))) {
      return alphaOf(alpha) < 1;
    }
    return false;
  }

  // 现代语法 `oklch(… / α)` / `color(… / α)` / `rgb(r g b / α)`
  const slash = v.match(/\/\s*([\d.]+%?)\s*\)/);
  if (slash) return alphaOf(slash[1]) < 1;

  return false;
}

/**
 * 扫描行级底色规则：只要有一条**不透明**，该行的拖选高亮就是隐形的。
 *
 * ## 为什么这是白屏级判据
 *
 * `drawSelection()` 把选中块画进 `.cm-selectionLayer`，该层 `z-index:-1`，而
 * `.cm-scroller` 是 `z-index:0` 的层叠上下文 —— 选中块因此位于所有 `.cm-line`
 * 背景**之下**，同时原生 `::selection` 已被 CM 置为透明。任何不透明行底（如
 * `color-mix(… 6%, var(--bg-secondary))`）都会让该行「文本已选中但毫无高亮」，
 * 且只在变更行出现（普通行只有 5% 的 `.cm-activeLine`），极难联想到行底色。
 * 拖动方向决定隐形的是头行还是尾行，单行内左右拖选则是整块选中不可见。
 *
 * 失效方向：判据被删/写错 → 下一次「实底更好看」的改动会静默复发，无任何测试变红。
 */
export function opaqueLineBackgroundViolations(css: string): string[] {
  const violations: string[] = [];
  for (const rule of parseRules(css)) {
    for (const cls of LINE_BACKGROUND_CLASSES) {
      if (!usesClass(rule, cls)) continue;
      for (const decl of rule.body.matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)) {
        const value = decl[1].trim();
        if (!isTranslucentBackground(value)) {
          violations.push(
            `\`${rule.selector}\` 的行底色 \`${value}\` 不透明 —— 会盖掉 \`.cm-selectionLayer\`（z-index:-1）的选中块，该行拖选无高亮`,
          );
        }
      }
    }
  }
  return violations;
}

/**
 * 返回契约违规清单（空数组 = 合规）。
 *
 * 三类判据：
 * 1. 行级底色规则**存在**（选择器被改名/删掉时立刻红，否则整套高亮静默消失）；
 * 2. 行级底色规则**声明了 background**（只留 `color` 的行底色等于没标）；
 * 3. 任何规则**不得**选择行内底块类（这条才是「不许叠底块」的闸门）。
 */
export function changeHighlightViolations(surface: ChangeHighlightSurface, css: string): string[] {
  const rules = parseRules(css);
  const violations: string[] = [];

  for (const selector of surface.lineSelectors) {
    const blocks = declarationsOf(rules, selector);
    if (blocks.length === 0) {
      violations.push(`找不到行级底色规则 \`${selector}\` —— 变更标记消失（选择器被改写/删除？）`);
      continue;
    }
    for (const body of blocks) {
      if (!/\bbackground(-color)?\s*:/.test(body)) {
        violations.push(`\`${selector}\` 必须声明 background：行级底色是唯一的变更标记`);
      }
    }
  }

  for (const rule of rules) {
    for (const cls of FORBIDDEN_INLINE_CLASSES) {
      if (usesClass(rule, cls)) {
        violations.push(
          `\`${rule.selector}\` 重新引入了行内底块 \`.${cls}\` —— 变更标记只走行级底色，行内叠底会盖掉语法色`,
        );
      }
    }
  }

  return violations;
}
