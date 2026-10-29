/**
 * 组件 CSS 的解析原语（非测试模块）。
 *
 * ## 职责边界
 *
 * 只做「把一段 CSS 文本变成规则列表」这一件事，**不含任何业务契约**。
 * 契约各自落在自己的判据模块里（`inlineCodeCss.ts` / `changeHighlightCss.ts` / `xtermCss.ts`），
 * 于是新增一条契约只需新增一个判据模块，不必再抄一遍扫描器 —— 本文件诞生前，
 * 「剥注释」有 3 份实现、「规则扫描」有 2 份（其中一份是浅层正则，遇嵌套容器会读错）。
 *
 * ## 为什么判据要抽成非测试模块
 *
 * `src/styles/README.md` 的硬规定：「真实文件与反证用例必须走同一个函数」。
 * 判据写成测试内的内联逻辑时，反证用例会自己重算一遍，于是无论判据怎么写都会绿
 * （`themeCss.ts` 顶部记录过这次假测试事故）。
 */

/**
 * 剥掉 CSS **块**注释。
 *
 * ## 为什么必须剥（2026-10-28 踩到）
 *
 * 判据只能在**源码**上跑，注释不是源码。不剥时实测过的三种假阳性：
 *
 * 1. 文档注释里写一句 `--terminal-bg: var(--bg-secondary)` → `[^;]+` 吃到下一个
 *    `;`（跨行），把一个**从不存在于该主题的变量**登记进变量清单，报「多出未登记变量」；
 * 2. 注释里举例一个 `:root { }` 块 → 块解析器当真块解析；
 * 3. 注释里提一句 `color-scheme:` → 缺少声明的检查假通过。
 *
 * 失效方向都是「注释的内容被当成声明」，即**误导维护者去改正确的东西**。
 *
 * 只剥块注释（斜杠星号开头到星号斜杠），不碰 `//`：CSS 没有行注释，
 * 而 `url(https://…)` 里的双斜杠会被误剥。
 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** 一条 CSS 规则块 */
export interface CssRule {
  /** 规整化后的**整条**选择器列表文本（`a,b` → `a, b`）；子串匹配用 */
  selector: string;
  /** 选择器列表逐项（去首尾空白）；精确匹配用 */
  selectors: string[];
  /** 声明体原文（不含外层花括号） */
  body: string;
}

/**
 * 按花括号配平解析出全部**规则块**（注释已剥）。
 *
 * - 支持 `@layer` / `@media` / `@supports` 嵌套：容器块自身不产规则，其内部规则照常产出
 *   （浅层正则做法会把容器前缀并进选择器文本，或干脆漏掉嵌套规则）；
 * - 只切结构，不做 CSS 语义校验（不判断属性是否合法、值是否可用）。
 */
export function parseRules(css: string): CssRule[] {
  const src = stripComments(css);
  const rules: CssRule[] = [];
  const stack: { prelude: string; bodyStart: number }[] = [];
  let preludeStart = 0;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') {
      stack.push({ prelude: src.slice(preludeStart, i), bodyStart: i + 1 });
      preludeStart = i + 1;
      continue;
    }
    if (ch !== '}') continue;
    const open = stack.pop();
    if (!open) continue; // 多余的右括号：容忍，不因排版瑕疵判违规
    const prelude = open.prelude.replace(/\s+/g, ' ').trim();
    if (prelude && !prelude.startsWith('@')) {
      rules.push({
        selector: prelude,
        selectors: prelude
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        body: src.slice(open.bodyStart, i),
      });
    }
    preludeStart = i + 1;
  }

  return rules;
}

/**
 * 取出选择器**逐项精确等于** `selector` 的全部规则声明体。
 *
 * 返回数组而非单值：同一选择器允许出现多段（基础规则 + 状态叠加），
 * 只取第一段会让后续段落静默漂移（`inlineCodeCss.ts` 记录过同类事故）。
 */
export function declarationsOf(rules: readonly CssRule[], selector: string): string[] {
  return rules.filter((r) => r.selectors.includes(selector)).map((r) => r.body);
}
