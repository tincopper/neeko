/**
 * **work-items 面板的可见文案一律英文**（2026-11-03）。
 *
 * # 为什么要一条护栏测试，而不是「记得写英文」
 *
 * 用户反馈：「页面内容显示使用英文，保持一致性，不要部分应用部分中文，都采用英文」。
 *
 * 半中半英的形态不是「某一处写错了」，而是**同一个界面里两种语言并存** ——
 * 工具栏是英文（Board / List / GitHub PRs）、空态是中文（「还没有工作项」）、
 * 列头又是中文（「共 N 条」）。这类混排最难自查：每加一条文案时你只看自己那一行，
 * 而「一致性」是一条**全局**属性，只能整体断言。
 *
 * # 判据的范围（这决定了它不会误伤）
 *
 * 只查**可见文案**，不查注释与设计说明：
 *
 * | 查 | 不查 |
 * | --- | --- |
 * | JSX 文本节点（`<p>中文</p>`，**以及独占一行的裸文本**） | 文件头 JSDoc（项目惯例是中文注释） |
 * | `aria-label` / `placeholder` / `title` / `alt` 的属性值 | 行内 `//` 注释、JSX 注释（`{/*` 起头） |
 * | 单/双引号与模板字符串里的用户可见串 | `console.*(…)` 的参数（日志不进界面） |
 *
 * 最后一条是**刻意的例外**：日志不进界面，而开发期日志用中文是这个项目的既定惯例。
 * 把它们也翻成英文等于让日志与注释语言分裂。
 *
 * # 为什么按文件扫而不是按组件渲染
 *
 * 渲染一棵树只能覆盖当前分支（board vs list、有数据 vs 空态、详情开 vs 关）。
 * 而「语言一致性」要对**全部**分支成立。所以扫源码文本：漏一条就红，与分支无关。
 *
 * # 判据演进史（这决定了它为什么是逐字符扫描，而不是几条正则）
 *
 * 首版是「按行跑几条正则」：
 *
 * ```ts
 * line.matchAll(/>([^<>{}\n]*[\u4e00-\u9fff][^<>{}\n]*)</g)   // 只认 `>中文<`
 * ```
 *
 * 三条实测失效（2026-11-03，全部**绿着漏掉**）：
 *
 * | 漏掉的形态 | 源码长相 | 为什么首版抓不到 |
 * | --- | --- | --- |
 * | **独占一行的裸 JSX 文本** | `            还没有工作项` | 没有 `>` / `<` 包着，正则要的是 `>…<` |
 * | 多行 Button 的子文本 | `<Button>\n  创建第一条工作项\n</Button>` | 同上 |
 * | 中文全角标点 | `` `${label} PR：${err}` `` | 判据只查 CJK 表意文字，`：` 不在范围内 |
 *
 * 同时它**误伤**不了什么也**漏放**了什么：整行含 `console.` 就跳过 ——
 * 于是一行里「先 `console.error` 再 `showToast('中文')`」的写法也被放行。
 *
 * 所以现在改成**逐字符扫描**（`visibleTextOf`）：剥注释、剥 `console.*(…)` 的参数，
 * 留下「可能渲染到界面上」的文本，再查其中是否有中文（含全角标点）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const FEATURE_DIR = join(__dirname, '..');
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/**
 * 中文判据：CJK 表意文字（含扩展 A）+ CJK 标点（`\u3000-\u303f`）+ 全角形式（`\uff01-\uff60`）。
 *
 * 为什么必须带标点：`` `${label} PR：${err}` `` 里唯一的破绽就是那个全角冒号 ——
 * 半中半英的典型长相是「英文词 + 中文标点」，只查表意文字会整片放行。
 *
 * 刻意**不含**的字符（它们在英文文案里合法）：
 * `…`（U+2026，`Loading work items…`）、`·`（U+00B7，`Commit Diff · foo.ts`）。
 */
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff01-\uff60]/;

/** 逐文件扫描时跨行保留的状态。 */
export interface ScanState {
  /** 在块注释里（含 JSX 的 `{/*` 起头那种）。 */
  inBlockComment: boolean;
  /** > 0 表示在 `console.*(…)` 的参数里，值为括号深度（可跨行）。 */
  consoleDepth: number;
}

export function createScanState(): ScanState {
  return { inBlockComment: false, consoleDepth: 0 };
}

/** 收集 work-items 下的生产代码（跳过测试与 `__tests__`）。 */
function productionFiles(): string[] {
  const out: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry === '__tests__' || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
        continue;
      }
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
    }
  }

  walk(FEATURE_DIR);
  return out;
}

/**
 * 逐字符扫描一行，返回**可能渲染到界面**的文本。
 *
 * 保留：代码骨架 + 字符串内容（用户可见文案就住在字面量里）。
 * 剥掉：块注释 / 行注释 / `console.*(…)` 的参数 / **分隔符类正则字面量**。
 *
 * 不做完整的 JSX 解析 —— 也不需要：判据只问「这行剩下的文本里有没有中文」。
 * 正则方案漏掉的正是「没有 `>` `<` 包着的裸文本」，而那些字符本来就会原样留在结果里。
 *
 * # 为什么要剥 `/[…]/` 形态的正则字面量
 *
 * `text.split(/[,，]/)` 里的全角逗号是**数据**（用户可能用中文逗号分隔标签），不是文案。
 * 它永远不会被渲染，但逐字符扫描会把它当成中文可见文案。判据只剥「字符类」形态
 * （`/[…]/`，由 `(` 引导）—— 那正是分隔符的正则长相，且不含任何字符串内容。
 */
export function visibleTextOf(line: string, state: ScanState = createScanState()): string {
  // JSDoc 续行（` * 说明文字`）：只可能出现在块注释里，但**首版把「整行以 `*` 开头」也当注释**。
  // 保留这条：生产代码里没有以 `*` 开头的语句，而单行入口（反证用例）需要它。
  if (state.consoleDepth === 0 && !state.inBlockComment && line.trim().startsWith('*')) return '';

  let out = '';
  let quote: '"' | "'" | '`' | null = null;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    // ① 块注释优先：注释里的引号与括号都不改变状态
    if (state.inBlockComment) {
      if (ch === '*' && next === '/') {
        state.inBlockComment = false;
        i += 1;
      }
      continue;
    }

    // ② console 的参数里：只维护括号深度与字符串闭合，不收集文本
    if (state.consoleDepth > 0) {
      // 顺序要紧：先判「在字符串里」，再判「字符串开头」—— 反过来会让闭合引号被当成
      // 新开的引号，于是 `)` 永远等不到，参数外的文案被整行吞掉。
      if (quote !== null) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '(') state.consoleDepth += 1;
      else if (ch === ')') state.consoleDepth -= 1;
      continue;
    }

    // ③ 字符串内容保留（`title="中文"` / `showToast('中文')` 都要抓）
    if (quote !== null) {
      if (ch === '\\') {
        out += ch + (next ?? '');
        i += 1;
        continue;
      }
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }

    // ④ 注释起点
    if (ch === '/' && next === '*') {
      state.inBlockComment = true;
      i += 1;
      continue;
    }
    // 行注释到 EOL。`//` 紧跟 `:` 是 URL（`https://…`），不是注释。
    if (ch === '/' && next === '/' && line[i - 1] !== ':') break;

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }

    // ⑤ `console.*(` 的参数整段丢弃（含跨行）
    if (ch === 'c' && line.startsWith('console.', i)) {
      const call = /^console\.(?:warn|error|log|info)\s*\(/.exec(line.slice(i));
      if (call !== null) {
        state.consoleDepth = 1;
        i += call[0].length - 1;
        continue;
      }
    }

    out += ch;
  }

  return stripCharClassRegex(out);
}

/** 剥掉 `(/[…]/)` 形态的分隔符正则（见 `visibleTextOf` 的说明）。 */
function stripCharClassRegex(text: string): string {
  return text.replace(/\(\s*\/[^/\n]*\/\s*\)/g, '()');
}

/**
 * 从一行代码里抽出**用户可见**的中文片段（`visibleTextOf` 的字符串视图）。
 *
 * 单行入口，供「反证」用例证明判据本身有判别力。跨行状态由 `visibleTextOf` 自己管。
 */
export function visibleCjkOf(line: string): string[] {
  return visibleTextOf(line).match(new RegExp(CJK.source, 'g')) === null
    ? []
    : [visibleTextOf(line)];
}

describe('work-items — 可见文案一律英文', () => {
  it('生产代码里没有中文可见文案（注释与 console 说明除外）', () => {
    const failures: string[] = [];

    for (const file of productionFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n');
      // 状态**逐文件**重置：块注释与 console 调用不会跨文件
      const state = createScanState();
      lines.forEach((line, index) => {
        const visible = visibleTextOf(line, state);
        if (CJK.test(visible)) {
          failures.push(`${relative(REPO_ROOT, file)}:${index + 1}  ${visible.trim()}`);
        }
      });
    }

    expect(failures).toEqual([]);
  });

  /**
   * 反证：判据对四种**真实出现过**的形态都有判别力。
   *
   * 只写「能抓到 JSX 文本」是不够的 —— 首版就是这样，而它漏掉了裸文本行、
   * 多行子文本、全角标点。这里逐条钉住，任何一条被改窄都会立刻红。
   */
  it('反证：裸文本行 / 属性值 / 模板串 / 全角标点都能抓到', () => {
    // ① 独占一行的裸 JSX 文本（首版漏掉的那一类）
    expect(visibleCjkOf('            还没有工作项')).toEqual(['            还没有工作项']);
    // ② 多行元素里的子文本
    expect(visibleCjkOf('            创建第一条工作项')).toEqual(['            创建第一条工作项']);
    // ③ 同行 JSX 文本
    expect(visibleCjkOf('<p>还没有工作项</p>')).not.toEqual([]);
    // ④ 属性值
    expect(visibleCjkOf('<div aria-label="工作项看板" />')).not.toEqual([]);
    // ⑤ 模板串
    expect(visibleCjkOf('const label = `${n} 条工作项`;')).not.toEqual([]);
    // ⑥ 全角标点（唯一破绽是那个 `：`）
    expect(visibleCjkOf('const msg = `${label} PR：${err}`;')).not.toEqual([]);
  });

  it('反证：注释 / console 参数 / 合法英文标点不该被误判', () => {
    expect(visibleCjkOf('<p>No work items yet</p>')).toEqual([]);
    expect(visibleCjkOf(' * 这是注释，不算可见文案')).toEqual([]);
    expect(visibleCjkOf('  // 行注释也不查')).toEqual([]);
    // 英文文案里的 `…` 与 `·` 是合法的，判据刻意不含它们
    expect(visibleCjkOf('const t = "Loading work items…";')).toEqual([]);
    expect(visibleCjkOf('const t = "Commit Diff · foo.ts";')).toEqual([]);
  });

  /**
   * 反证：`console.*(…)` 的例外**只覆盖参数**，不覆盖整行。
   *
   * 首版是「整行含 `console.` 就跳过」—— 于是一行里「先日志再 toast」的写法也被放行，
   * 而 toast 是渲染到界面上的。
   */
  it('反证：console 例外只覆盖它自己的参数（同行其它文案仍被查）', () => {
    expect(visibleCjkOf("console.error('读取失败')")).toEqual([]);
    // 参数内的中文被剥掉，参数外的 toast 文案仍在 —— 这正是首版「整行含 console 就跳过」漏掉的
    expect(visibleCjkOf("console.error('读取失败'); showToast('保存失败', 'error')")).toEqual([
      "; showToast('保存失败', 'error')",
    ]);
  });
});
