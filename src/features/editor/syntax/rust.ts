/**
 * Rust 的测试用例与 main 入口发现（**AST 实现**，取代 `testCases.ts::parseRustCases`
 * 与 `mainEntries.ts::parseRustMain` 的行正则）。
 *
 * 实测 AST 形态（`@lezer/rust@1.0.2`）：
 * ```text
 * AttributeItem                      ← 属性 + 其修饰的 item 是**父子**关系
 *   Attribute → MetaItem → Identifier "test"          // #[test]
 *   Attribute → MetaItem → ScopedIdentifier "tokio::test"  // #[tokio::test(flavor = …)]
 *   FunctionItem → BoundIdentifier "parse_simple"
 * ```
 * 关键点：
 * - **多属性是多个 `Attribute` 兄弟**（`#[test] #[ignore]` 或分行的 `#[test]` + `#[ignore]`），
 *   故须遍历**全部** `Attribute` 子节点，不能只看第一个；
 * - 带参属性的参数在 `MetaItem` 内，故属性名取 **`MetaItem` 的首个 `Identifier`/`ScopedIdentifier`**
 *   （`ScopedIdentifier` 文本即 `tokio::test`，不含参数）；
 * - `#[cfg(test)]` 的名字是 `cfg`（其子 `Identifier "test"` 不是属性名）→ 天然不误判；
 * - `mod` 内嵌的属性在树中可达（walk 覆盖）。
 *
 * 相对旧正则的两处**显式记录**差异：
 * 1. 旧实现用 `startsWith('#[tokio::test')`，会**过度匹配** `#[tokio::testing]`；新实现精确匹配
 *    属性名 `tokio::test`（更正确）；
 * 2. `#[tokio::main] async fn main()` 的 main 检测与普通 `fn main` **结构完全相同** ——
 *    旧实现需两个正则且曾因 `RUST_MAIN_LINE` 不含 `async` 而漏识别（2026-09-11 线上 bug）。
 */

import type { MainEntry, SyntaxDoc, TestCaseInfo } from './contract';
import {
  childOfType,
  childrenOfType,
  createLineLookup,
  walkPruned,
  type SyntaxNode,
} from './lezer';

/** 视为测试声明的属性名（精确匹配，见文件头差异 1）。 */
const RUST_TEST_ATTRIBUTES = new Set(['test', 'tokio::test']);

/**
 * 剪枝：**函数体（`Block`）无需进入** —— `#[test]`/`main` 都体现在 `AttributeItem` / `FunctionItem`
 * 的**声明层**，与函数体内容无关。
 *
 * 实测关键点：`mod tests { … }` 的体是 **`DeclarationList`**（不是 `Block`）→ 剪掉 `Block` 不会
 * 丢掉 `mod` 内的测试（`mod` 内嵌是既有测试覆盖的行为）。
 */
function cutFunctionBodies(node: SyntaxNode): boolean {
  return node.type.name === 'Block';
}

/** `MetaItem` 的属性名：首个 `Identifier`（`test`/`cfg`）或 `ScopedIdentifier`（`tokio::test`）。 */
function attributeName(docText: string, attribute: SyntaxNode): string {
  const meta = childOfType(attribute, 'MetaItem');
  if (!meta) return '';
  for (let child = meta.firstChild; child; child = child.nextSibling) {
    const kind = child.type.name;
    if (kind === 'Identifier' || kind === 'ScopedIdentifier') {
      return docText.slice(child.from, child.to);
    }
  }
  return '';
}

/** Rust 测试用例发现（AST）。`line` 取**属性行**（与旧实现一致）。 */
export function discoverRustTests(sd: SyntaxDoc): TestCaseInfo[] {
  const { tree, docText } = sd;
  const lineAt = createLineLookup(docText);
  const cases: TestCaseInfo[] = [];

  walkPruned(tree.topNode, cutFunctionBodies, (node) => {
    if (node.type.name !== 'AttributeItem') return;
    // 属性必须直接修饰一个函数（`#[test]` 后面不是 fn → 跳过，如 `#[test] let x = 1;`）
    const fn = childOfType(node, 'FunctionItem');
    if (!fn) return;
    const isTest = childrenOfType(node, 'Attribute').some((attr) =>
      RUST_TEST_ATTRIBUTES.has(attributeName(docText, attr)),
    );
    if (!isTest) return;
    const nameNode = childOfType(fn, 'BoundIdentifier');
    if (!nameNode) return;
    cases.push({
      name: docText.slice(nameNode.from, nameNode.to),
      line: lineAt(node.from),
      lang: 'rust',
    });
  });

  return cases;
}

/** Rust main 入口发现（AST）。`line` 取 `fn` 声明行（与旧实现一致）。 */
export function discoverRustMains(sd: SyntaxDoc): MainEntry[] {
  const { tree, docText } = sd;
  const lineAt = createLineLookup(docText);
  const entries: MainEntry[] = [];

  walkPruned(tree.topNode, cutFunctionBodies, (node) => {
    if (node.type.name !== 'FunctionItem') return;
    const nameNode = childOfType(node, 'BoundIdentifier');
    if (!nameNode) return;
    if (docText.slice(nameNode.from, nameNode.to) !== 'main') return;
    entries.push({ line: lineAt(node.from), language: 'rust' });
  });

  return entries;
}
