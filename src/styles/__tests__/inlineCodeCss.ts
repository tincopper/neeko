/**
 * 行内代码样式判据（非测试模块）。
 *
 * 为什么抽成纯函数：`src/styles/README.md` 的硬规定 —— 「任何判据的坏数据用例都写进测试文件，
 * 真实文件与反证用例走同一个函数」。判据写成测试内的 inline 逻辑时，反证用例会自己重算一遍，
 * 于是无论判据怎么写都会绿（`themeCss.ts` 顶部记录过这次假测试事故）。
 *
 * 判据对象有两层：
 * - **样式形态**（`inlineCodeStyleViolations`）：规则块里不得有底色、前景色必须取契约 token；
 * - **主题取值**（`inlineCodeThemeViolations`）：该 token 在每个主题下「读得清 + 看得出 +
 *   属于本主题调色板 + 不像链接」。
 */

import { type Rgb, contrastRatio, deltaE, hueDelta, stripComments, toOklch } from './themeCss';

/** 行内代码前景色 token（契约位，见 `shared/utils/themeVariables.ts` 的 `code` 组） */
export const INLINE_CODE_FG = '--code-inline-fg';

/** 行内代码会压到的宿主表面：正文 / 表格偶数行与引用块 / 表头 */
export const INLINE_CODE_SURFACES = ['--bg-primary', '--bg-secondary', '--bg-tertiary'] as const;

/** 正文色有两个：预览用 primary（`.markdown-preview`），对话正文用 secondary（`.rich p`） */
export const INLINE_CODE_BODY = ['--text-primary', '--text-secondary'] as const;

/** 链接色：`.markdown-preview a` / `.rich a` / LSP 悬浮文档的 `a` 都用它 */
export const INLINE_CODE_LINK = '--accent-blue';

/**
 * 允许的取色槽位 —— 行内代码的颜色必须是本主题调色板里某一支（只许调明度）。
 *
 * 刻意**不含** `--accent-blue`：那是链接色，码字与链接同色会被误读。
 * 也刻意不含 `--mono-fg`：one-dark-pro 里它与 `--text-primary` 同值，码字与正文分不开。
 */
export const INLINE_CODE_PALETTE = [
  '--accent-green',
  '--accent-yellow',
  '--accent-red',
  '--accent-orange',
  '--accent-brick',
  '--cm-string',
  '--cm-keyword',
  '--cm-function',
  '--cm-number',
  '--cm-tag',
] as const;

/** 正文级阈值（行内代码是句子的一部分，所以用 4.5 而不是坑 9 的 3.0） */
const MIN_CONTRAST = 4.5;
/** 「看得出是代码」：与正文的 OKLab 色差下限 */
const MIN_DELTA_BODY = 0.1;
/** 「不长得像链接」：与 `--accent-blue` 的色差下限 */
const MIN_DELTA_LINK = 0.12;
/** 「属于本主题调色板」：色相差上限 */
const MAX_HUE_OFF_PALETTE = 6;
/** 「属于本主题调色板」：彩度保留比例下限（防止洗淡成灰） */
const MIN_CHROMA_RATIO = 0.6;

/**
 * 默认的行内代码选择器；`& code:not(pre code)`（lsp.css 的嵌套写法）同样命中。
 *
 * `agent-chat.css` 用的是裸 `.rich code`（它靠 `.rich .codeblock code` / `.diff-expand code`
 * 两处重置把围栏代码块排除在外），所以那里显式传自己的选择器 —— 判据不猜，调用方声明。
 */
export const INLINE_CODE_SELECTOR = /code:not\(\s*pre\s+code\s*\)/;

/**
 * 取出 CSS 里**每一条**行内代码规则的声明文本。
 *
 * 逐条而不是只取第一条：同一语义元素曾在 `lsp.css` 里出现两处（hover 与签名文档），
 * 只校验一处会让另一处静默漂移 —— 与「徽标三套 DOM」是同型问题。
 */
export function inlineCodeBlocks(css: string, selector: RegExp = INLINE_CODE_SELECTOR): string[] {
  const src = stripComments(css);
  const blocks: string[] = [];
  for (const match of src.matchAll(new RegExp(selector.source, 'g'))) {
    const open = src.indexOf('{', match.index + match[0].length);
    if (open < 0) continue;
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          blocks.push(src.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return blocks;
}

/**
 * 样式形态判据：无底色 + 前景色取契约 token。
 *
 * 需求「行内代码不要背景色，只给文字一个颜色」把 chip（底色 + padding + 圆角）整条通道删掉了；
 * 若谁把它加回来，本判据立刻红 —— 否则下次只能靠肉眼在五个主题 × 三类位置里找。
 */
export function inlineCodeStyleViolations(
  css: string,
  selector: RegExp = INLINE_CODE_SELECTOR,
): string[] {
  const blocks = inlineCodeBlocks(css, selector);
  if (blocks.length === 0) {
    return ['找不到 `code:not(pre code)` 规则 —— 判据对象消失（选择器被改写？）'];
  }
  const violations: string[] = [];
  blocks.forEach((decls, index) => {
    const at = `第 ${index + 1} 处行内代码`;
    if (/\bbackground(-color)?\s*:/.test(decls)) {
      violations.push(`${at}仍在声明 background（需求：不要背景块，只给文字色）`);
    }
    if (!/color\s*:\s*var\(\s*--code-inline-fg\s*\)/.test(decls)) {
      violations.push(
        `${at}前景色必须是 var(${INLINE_CODE_FG})（裸色值 / accent / --mono-fg 均不合格）`,
      );
    }
  });
  return violations;
}

/**
 * 主题取值判据。`swatches` 是一个主题里相关 token 的色值（缺失的键视为「无法解析」），
 * 因此坏数据可以直接构造，不需要造一个坏 CSS 文件。
 *
 * 四条：读得清（对比度）、看得出（与正文色差）、属于本主题（色相/彩度）、不像链接。
 */
export function inlineCodeThemeViolations(
  file: string,
  swatches: Record<string, Rgb | null | undefined>,
): string[] {
  const failures: string[] = [];
  const fg = swatches[INLINE_CODE_FG];
  if (!fg) return [`${file} 无法解析 ${INLINE_CODE_FG}（契约位未定义？）`];

  for (const surface of INLINE_CODE_SURFACES) {
    const bg = swatches[surface];
    if (!bg) {
      failures.push(`${file} 无法解析 ${surface}`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    if (ratio < MIN_CONTRAST) {
      failures.push(`${file} 行内代码对比 ${ratio.toFixed(2)} < ${MIN_CONTRAST}（压 ${surface}）`);
    }
  }

  for (const body of INLINE_CODE_BODY) {
    const color = swatches[body];
    if (!color) {
      failures.push(`${file} 无法解析 ${body}`);
      continue;
    }
    const delta = deltaE(fg, color);
    if (delta < MIN_DELTA_BODY) {
      failures.push(
        `${file} 与 ${body} 色差 ΔE ${delta.toFixed(3)} < ${MIN_DELTA_BODY}（区分不了）`,
      );
    }
  }

  let nearest: { slot: string; hue: number; chromaRatio: number } | null = null;
  for (const slot of INLINE_CODE_PALETTE) {
    const ref = swatches[slot];
    if (!ref) continue;
    const hue = hueDelta(fg, ref);
    if (!nearest || hue < nearest.hue) {
      nearest = { slot, hue, chromaRatio: toOklch(fg)[1] / Math.max(toOklch(ref)[1], 1e-6) };
    }
  }
  if (!nearest) {
    failures.push(`${file} 找不到任何可比的调色板槽位`);
  } else if (nearest.hue > MAX_HUE_OFF_PALETTE) {
    failures.push(
      `${file} 色相不属于本主题调色板（最近 ${nearest.slot} 仍差 ${nearest.hue.toFixed(1)}°）`,
    );
  } else if (nearest.chromaRatio < MIN_CHROMA_RATIO) {
    failures.push(
      `${file} 彩度仅剩 ${nearest.slot} 的 ${(nearest.chromaRatio * 100).toFixed(0)}%（洗淡成灰）`,
    );
  }

  const link = swatches[INLINE_CODE_LINK];
  if (link) {
    const delta = deltaE(fg, link);
    if (delta < MIN_DELTA_LINK) {
      failures.push(
        `${file} 与链接色 ${INLINE_CODE_LINK} 色差 ΔE ${delta.toFixed(3)} < ${MIN_DELTA_LINK}（会被当成链接）`,
      );
    }
  }

  return failures;
}
