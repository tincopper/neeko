/**
 * Java 的测试用例与 main 入口发现（**AST 实现**，取代 `testCases.ts::parseJavaCases`
 * 与 `mainEntries.ts::parseJavaMain` 的行正则）。
 *
 * 实测 AST 形态（`@lezer/java@1.1.3`）：
 * ```text
 * MethodDeclaration
 *   Modifiers → MarkerAnnotation(@Test)      // 无参注解
 *             → Annotation(@Test(timeout=500)) → AnnotationArgumentList   // 带参注解
 *   void                                     // ← 返回类型是**字面 token**
 *   Definition "testOk"                      // 方法名（直接子节点；形参的 Definition 在 FormalParameters 内）
 *   FormalParameters
 * ```
 * 关键点：
 * - **必须 `void`**：`int testReturnsInt()` 的返回类型是 `PrimitiveType "int"` → 不产用例
 *   （与旧实现一致：JUnit 测试方法约定 `void`）；
 * - 注解名取 `Identifier`（`Test`）或 `ScopedIdentifier`（`org.junit.jupiter.api.Test`）；
 * - `@Test` 挂在**字段**上时是 `FieldDeclaration`（不是 `MethodDeclaration`）→ 天然跳过；
 * - **行号取「首个测试注解所在行」**（不是 `Modifiers.from`）：若 `@DisplayName` 在 `@Test`
 *   之前，两者不同 —— 取测试注解行与旧实现一致。
 *
 * 相对旧正则的**显式记录**差异：
 * - 旧 `^@([\w$]*Test)\b` 锚定行首且不含 `.` → **FQN 注解 `@org.junit.jupiter.api.Test` 不命中**；
 *   新实现按简单名/全名后缀判定 → **命中**（FQN 注解是合法且常见的写法，属正确性改进）。
 */

import type { MainEntry, SyntaxDoc, TestCaseInfo } from './contract';
import {
  childOfType,
  childrenOfType,
  createLineLookup,
  walkPruned,
  type SyntaxNode,
} from './lezer';

/** 注解节点类型（无参 `MarkerAnnotation` / 带参 `Annotation`）。 */
const ANNOTATION_NODES = new Set(['MarkerAnnotation', 'Annotation']);

/** `@Test` / `@ParameterizedTest` / `@RepeatedTest` / FQN `…Test` 的统一判据。 */
const TEST_ANNOTATION_SUFFIX = 'Test';

/**
 * 剪枝：**方法体（`Block`）无需进入** —— 测试与 main 都由 `MethodDeclaration` 的**声明层**决定
 * （注解 / 修饰符 / 返回类型 / 形参）。嵌套类挂在 `ClassBody`（不是 `Block`）下，故剪掉 `Block`
 * 不影响嵌套类中的方法（P3.2 的 `@Nested` 场景）。
 */
function cutMethodBodies(node: SyntaxNode): boolean {
  return node.type.name === 'Block';
}

/** 注解的**名字**：首个 `Identifier` 或 `ScopedIdentifier`（不含 `@`，不含参数）。 */
function annotationName(docText: string, annotation: SyntaxNode): string {
  for (let child = annotation.firstChild; child; child = child.nextSibling) {
    const kind = child.type.name;
    if (kind === 'Identifier' || kind === 'ScopedIdentifier') {
      return docText.slice(child.from, child.to);
    }
  }
  return '';
}

/** `Modifiers` 里首个「测试注解」节点（用于取行号；无 → null）。 */
function findTestAnnotation(docText: string, modifiers: SyntaxNode): SyntaxNode | null {
  for (let child = modifiers.firstChild; child; child = child.nextSibling) {
    if (!ANNOTATION_NODES.has(child.type.name)) continue;
    if (annotationName(docText, child).endsWith(TEST_ANNOTATION_SUFFIX)) return child;
  }
  return null;
}

/** Java 测试用例发现（AST）。`line` 取**测试注解行**。 */
export function discoverJavaTests(sd: SyntaxDoc): TestCaseInfo[] {
  const { tree, docText } = sd;
  const lineAt = createLineLookup(docText);
  const cases: TestCaseInfo[] = [];

  walkPruned(tree.topNode, cutMethodBodies, (node) => {
    if (node.type.name !== 'MethodDeclaration') return;
    const modifiers = childOfType(node, 'Modifiers');
    if (!modifiers) return;
    const testAnnotation = findTestAnnotation(docText, modifiers);
    if (!testAnnotation) return;
    // JUnit 测试方法约定 `void`：非 void 不产用例（`void` 是字面 token，非 void 为具体类型节点）
    if (!childOfType(node, 'void')) return;
    const nameNode = childOfType(node, 'Definition');
    if (!nameNode) return;
    cases.push({
      name: docText.slice(nameNode.from, nameNode.to),
      line: lineAt(testAnnotation.from),
      lang: 'java',
    });
  });

  return cases;
}

/** `Modifiers` 是否含 `static`（字面 token）。 */
function hasStaticModifier(modifiers: SyntaxNode): boolean {
  return childOfType(modifiers, 'static') !== null;
}

/**
 * `main` 的形参是否满足 `String[]` / `String...`（且**恰好一个**形参）—— 与旧 `JAVA_MAIN_DECL` 一致。
 *
 * 实测形态（注意 varargs 与数组的**包装层级不同**，这是本函数的关键）：
 * - `String[] args` → `FormalParameters → FormalParameter → ArrayType → TypeName "String"`
 * - `String... a`   → `FormalParameters → **SpreadParameter**（直接子节点，无 FormalParameter 包装）
 *                       → TypeName "String"`；带修饰符时也可能为 `FormalParameter → SpreadParameter`
 * - `int[] xs`      → `ArrayType → PrimitiveType "int"`（须拒绝）
 * - `String args[]`（C 风格）→ 无 `ArrayType`（旧模式同样不匹配，保持一致）
 */
function hasStringArrayParameter(docText: string, formalParameters: SyntaxNode | null): boolean {
  if (!formalParameters) return false;

  // varargs 直接挂在 FormalParameters 下，不套 FormalParameter
  const directSpreads = childrenOfType(formalParameters, 'SpreadParameter');
  const params = childrenOfType(formalParameters, 'FormalParameter');
  if (directSpreads.length + params.length !== 1) return false;

  if (directSpreads.length === 1) {
    return isStringTypeName(docText, childOfType(directSpreads[0], 'TypeName'));
  }

  const param = params[0];
  const arrayType = childOfType(param, 'ArrayType');
  if (arrayType) return isStringTypeName(docText, childOfType(arrayType, 'TypeName'));
  const spread = childOfType(param, 'SpreadParameter');
  if (spread) return isStringTypeName(docText, childOfType(spread, 'TypeName'));
  return false;
}

/** 该 `TypeName` 节点是否恰为 `String`（`int[]` 会落到 `PrimitiveType` → null → false）。 */
function isStringTypeName(docText: string, typeName: SyntaxNode | null): boolean {
  return typeName !== null && docText.slice(typeName.from, typeName.to) === 'String';
}

/** Java main 入口发现（AST）。`line` 取 `main` 名字所在行（与旧实现一致）。 */
export function discoverJavaMains(sd: SyntaxDoc): MainEntry[] {
  const { tree, docText } = sd;
  const lineAt = createLineLookup(docText);
  const entries: MainEntry[] = [];

  walkPruned(tree.topNode, cutMethodBodies, (node) => {
    if (node.type.name !== 'MethodDeclaration') return;
    const modifiers = childOfType(node, 'Modifiers');
    if (!modifiers || !hasStaticModifier(modifiers)) return;
    if (!childOfType(node, 'void')) return;
    const nameNode = childOfType(node, 'Definition');
    if (!nameNode) return;
    if (docText.slice(nameNode.from, nameNode.to) !== 'main') return;
    if (!hasStringArrayParameter(docText, childOfType(node, 'FormalParameters'))) return;
    entries.push({ line: lineAt(nameNode.from), language: 'java' });
  });

  return entries;
}
