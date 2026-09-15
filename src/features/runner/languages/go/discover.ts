/**
 * Go 的测试用例与 main 入口发现（**AST 实现**，取代 `testCases.ts::parseGoCases`
 * 与 `mainEntries.ts::parseGoMain` 的行正则，也是 `languageSyntax.ts` 的最后消费者）。
 *
 * 实测 AST 形态（`@lezer/go@1.0.1`）：
 * ```text
 * FunctionDecl → DefName "TestAdd" + Parameters      // 普通函数
 * MethodDecl   → Parameters(接收者) + Parameters      // 接收者方法（**无直接 DefName**）
 * ```
 * 关键点：
 * - **接收者方法天然排除**：`func (s *Suite) TestMethod(t *testing.T)` 是 `MethodDecl`（非
 *   `FunctionDecl`）→ 无需像旧正则那样靠 `^func\s+[A-Za-z_]` 间接排掉「`func ` 后跟 `(`」；
 * - 注释 / 字符串里的 `func TestX` 不是 `FunctionDecl` → 天然不误报（旧实现需逐行跳注释）；
 * - `Test*` → 用例；`Benchmark*` → 基准（`variant: 'benchmark'`）；其余（`Example*` / `Fuzz*` /
 *   helper）不检测 —— 与旧实现一致（`-run`/`-bench` 对它们无对应语义）；
 * - **不做签名校验**（`*testing.B` 等）：与旧实现一致，误报由「零命中告警」兜住。
 */

import type { MainEntry, SyntaxDoc, TestCaseInfo } from '../../syntax/contract';
import { childOfType, createLineLookup, walkPruned, type SyntaxNode } from '../../syntax/lezer';

import { collectTableSubtests } from './table';

/**
 * 剪枝：**函数体（`Block`）在「找声明 / 找 main」阶段无需进入** —— 顶层 `FunctionDecl` / `MethodDecl`
 * 都在函数体之外。表格子测试不走本walk：`collectTableSubtests` 从函数节点**定向导航**
 * （`FunctionDecl → Block → VarDecl`）并在循环体内做有界遍历，故剪掉全部 `Block` 不影响功能，
 * 只把遍历量从「整个文件的节点数」降到「声明数量级」。
 */
function cutFunctionBodies(node: SyntaxNode): boolean {
  return node.type.name === 'Block';
}

/** `FunctionDecl` 的名字（`DefName` 直接子节点）。 */
function functionName(docText: string, node: SyntaxNode): string | null {
  const nameNode = childOfType(node, 'DefName');
  return nameNode ? docText.slice(nameNode.from, nameNode.to) : null;
}

/** Go 测试用例发现（AST）。`line` 取 `func` 声明行（与旧实现一致）。 */
export function discoverGoTests(sd: SyntaxDoc): TestCaseInfo[] {
  const { tree, docText } = sd;
  const lineAt = createLineLookup(docText);
  const cases: TestCaseInfo[] = [];

  // **单次剪枝遍历**同时产出：顶层用例/基准 + `Test*` 内部的表格驱动子测试。
  // 剪掉函数体 → 访问量与「声明数」同阶（此前是全树 walk，访问量与整个文件的节点数同阶）。
  walkPruned(tree.topNode, cutFunctionBodies, (node) => {
    // 只用 FunctionDecl：`MethodDecl`（接收者方法）天然不在「用例 / main」语义内
    if (node.type.name !== 'FunctionDecl') return;
    const name = functionName(docText, node);
    if (name === null) return;
    const line = lineAt(node.from);
    if (name.startsWith('Test')) {
      cases.push({ name, line, lang: 'go' });
      // P4-3：表格驱动子测试 —— 每个表格元素行一个可运行目标（名字/行号由 `goTable.ts` 推导，
      // 并复刻 Go 的运行时净化）。gutter 侧按行号排序，故与顶层用例混排无需额外处理。
      cases.push(...collectTableSubtests(sd, node, name, lineAt));
    } else if (name.startsWith('Benchmark')) {
      cases.push({ name, line, lang: 'go', variant: 'benchmark' });
    }
  });

  return cases;
}

/** Go main 入口发现（AST）。`line` 取 `func` 声明行。 */
export function discoverGoMains(sd: SyntaxDoc): MainEntry[] {
  const { tree, docText } = sd;
  const lineAt = createLineLookup(docText);
  const entries: MainEntry[] = [];

  walkPruned(tree.topNode, cutFunctionBodies, (node) => {
    if (node.type.name !== 'FunctionDecl') return;
    if (functionName(docText, node) !== 'main') return;
    entries.push({ line: lineAt(node.from), language: 'go' });
  });

  return entries;
}
