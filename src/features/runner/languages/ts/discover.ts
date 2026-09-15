/**
 * TS/JS 的测试用例发现（**AST 实现**，取代 `utils/testCases.ts::parseTsCases` 的行正则）。
 *
 * 识别的调用：`test(...)` / `it(...)`，含修饰符成员调用 `it.only` / `it.skip` / `it.concurrent`。
 * 首参必须是字符串字面量（`String`）或模板串（`TemplateString`，含 `${}` 插值）。
 *
 * **相对行正则的行为改进（显式记录，非静默改）**：正则版刻意要求调用在**行首**，
 * 因此 `const runIt = it('x', …)` 不被识别 —— 那纯粹是正则无法区分「真调用 / 注释 / 字符串」的
 * 妥协（见旧测试 `should_ignore_calls_not_at_line_start`）。AST 能可靠区分：
 * 注释与字符串里的文本不是 `CallExpression`，而 `const runIt = it('x')` 在运行时**确实注册了测试**，
 * 故新实现识别它。该差异已同步到测试与 design §7.9。
 */

import type { SyntaxDoc, TestCaseInfo } from '../../syntax/contract';
import {
  childOfType,
  createLineLookup,
  isPunctuationNode,
  walkPruned,
  type SyntaxNode,
} from '../../syntax/lezer';

/** 视为测试声明的被调名（`describe` 刻意排除：它是分组，不是用例）。 */
const TEST_CALLEES = new Set(['test', 'it']);

/** 首个实参节点（跳过标点）。 */
function firstArgumentNode(argList: SyntaxNode): SyntaxNode | null {
  for (let child = argList.firstChild; child; child = child.nextSibling) {
    if (isPunctuationNode(child)) continue;
    return child;
  }
  return null;
}

/**
 * 该 `CallExpression` 是否为 `test` / `it`（含 `it.only` 这类成员修饰符形态）。
 *
 * 抽成函数供**两处**共用：① 命中判定；② 剪枝判定（已确认是测试调用后，其**实参表与回调体
 * 一律无需进入** —— 名字已取到，测试体内容与「用例发现」无关）。两处若各写一遍判定，
 * 就是 code-reuse 指南「模式 5」的副本漂移隐患。
 */
function isTestCall(call: SyntaxNode, docText: string): boolean {
  const callee = call.firstChild;
  if (!callee) return false;
  if (callee.type.name === 'VariableName') {
    return TEST_CALLEES.has(docText.slice(callee.from, callee.to));
  }
  if (callee.type.name === 'MemberExpression') {
    const base = childOfType(callee, 'VariableName');
    return base !== null && TEST_CALLEES.has(docText.slice(base.from, base.to));
  }
  return false;
}

/** TS 字符串转义的还原（与旧实现保持一致：只还原 `\\` `\'` `\"` `` \` ``）。 */
function unescapeTsName(raw: string): string {
  return raw.replace(/\\(['"`\\])/g, '$1');
}

/** TS/JS 测试用例发现（AST）。 */
export function discoverTsTests(sd: SyntaxDoc): TestCaseInfo[] {
  const { tree, docText } = sd;
  const lineAt = createLineLookup(docText);
  const cases: TestCaseInfo[] = [];

  // 剪枝：命中测试调用后其**实参表整体跳过**（回调体通常很长，而用例发现只需名字）。
  // 不做容器白名单（漏写容器会**静默漏目标**）；默认下钻 + 只剪已知无关子树。
  const cut = (node: SyntaxNode, parent: SyntaxNode | null): boolean =>
    node.type.name === 'ArgList' && parent !== null && isTestCall(parent, docText);

  walkPruned(tree.topNode, cut, (node) => {
    if (node.type.name !== 'CallExpression') return;
    if (!isTestCall(node, docText)) return;

    const argList = childOfType(node, 'ArgList');
    if (!argList) return;
    const firstArg = firstArgumentNode(argList);
    if (!firstArg) return;
    if (firstArg.type.name !== 'String' && firstArg.type.name !== 'TemplateString') return;

    const raw = docText.slice(firstArg.from, firstArg.to);
    if (raw.length < 2) return;
    const quote = raw[0];
    // 要求配对引号（未闭合/畸形 → 放弃，不猜）
    if (raw[raw.length - 1] !== quote) return;

    cases.push({
      name: unescapeTsName(raw.slice(1, -1)),
      line: lineAt(node.from),
      lang: 'ts',
    });
  });

  return cases;
}
