/**
 * Go **表格驱动子测试**的发现（AST 实现）——Gutter 上「每行一个运行按钮」的来源。
 *
 * 为什么必须用 AST：子测试名来自**表格字面量**，需要「struct 字段序 → 元素取值 → 循环绑定 →
 * `t.Run` 名字表达式」的**结构**推导。逐行正则在任何一处（字符串内含逗号、注释、跨行元素、
 * 字段序）都会错，且错得**静默**（给一个点了跑 0 个的按钮）。业界同解：GoLand 用 PSI、
 * Zed 用 tree-sitter 查询。本项目复用编辑器已挂载的 Lezer 语法（见 §7.9）。
 *
 * 识别的形状（首期）：
 * ```go
 * func TestFib(t *testing.T) {
 *     tests := []struct { name string; input, expected int }{   // 匿名 struct slice
 *         {"Negative input", -5, 0},                            // 位置式元素
 *         // 或 {name: "Zero input", input: 0, expected: 0},     // 键式元素
 *     }
 *     for _, tt := range tests {                                // 绑定 loop 变量 → 表
 *         t.Run(tt.name, func(t *testing.T) { … })              // 名字字段 = name
 *     }
 * }
 * ```
 *
 * **本质限制**（不产按钮，而不是猜）—— 与解析机制无关：
 * 1. **净化后重名**：运行时去重后缀 `#01`/`#02` 由**碰撞顺序**决定（Go 源码 `matcher.unique`），
 *    静态不可预测 → 该组一律不产；
 * 2. **名字非字符串字面量**（变量 / `fmt.Sprintf`）→ 静态不可求值 → 不产（P3 的动态菜单可给真名）；
 * 3. **命名 struct 类型**（`[]tc{…}`）→ 需跨处解析类型定义 → 不产；
 * 4. 元素非**单行字面量**（含转义、跨行、非 String）→ 该行不产。
 */

type LineAt = (pos: number) => number;

import type { SyntaxDoc, TestCaseInfo } from '../../syntax/contract';
import {
  childOfType,
  childrenOfType,
  isPunctuationNode,
  rawText,
  stringValue,
  walk,
  type SyntaxNode,
} from '../../syntax/lezer';

/** 表格声明的解析结果。 */
interface GoTable {
  /** 表变量名（用于与 `range` 绑定）。 */
  ident: string;
  /** struct 字段序（位置式元素按此映射）。 */
  fieldNames: string[];
  /** 每行的字面量节点（`LiteralValue`）。 */
  rows: SyntaxNode[];
}

/** `t.Run(loopVar.<field>, …)` 的绑定信息。 */
interface NameBinding {
  loopVar: string;
  field: string;
}

/**
 * 复刻 Go `testing.rewrite` 的名字净化：**空白类 rune → `_`（1:1）**，其余原样。
 *
 * 不净化必然匹配不上 —— 真机实证：`t.Run("Negative input")` 的运行时名是
 * `TestFib/Negative_input`，用带空格的 `-run` 模式**命中不了**（见 design §7.8.2）。
 * 含**不可打印** rune → 返回 `null`（放弃；完整复刻 `strconv.QuoteRune` 收益极低）。
 */
export function sanitizeGoSubtestName(raw: string): string | null {
  let out = '';
  for (const ch of raw) {
    const cp = ch.codePointAt(0) as number;
    if (isGoSpace(cp)) {
      out += '_';
      continue;
    }
    if (!isPrintableRune(cp)) return null;
    out += ch;
  }
  return out;
}

/**
 * Go `testing.isSpace`（源码 `match.go` 逐字复刻）——**刻意不用 JS 的 `\s`**：
 * JS `\s` 含 `\uFEFF` 等 Go 不认的字符，会在名字净化上产生静默分歧。
 */
function isGoSpace(cp: number): boolean {
  if (cp < 0x2000) {
    switch (cp) {
      case 0x09: // \t
      case 0x0a: // \n
      case 0x0b: // \v
      case 0x0c: // \f
      case 0x0d: // \r
      case 0x20: // 空格
      case 0x85:
      case 0xa0: // NBSP
      case 0x1680:
        return true;
      default:
        return false;
    }
  }
  if (cp <= 0x200a) return true;
  switch (cp) {
    case 0x2028:
    case 0x2029:
    case 0x202f:
    case 0x205f:
    case 0x3000:
      return true;
    default:
      return false;
  }
}

/** 近似 Go `strconv.IsPrint`：只挡控制字符与代理区（现实子测试名不会触及更细的分类）。 */
function isPrintableRune(cp: number): boolean {
  if (cp < 0x20 || cp === 0x7f) return false;
  if (cp >= 0x80 && cp <= 0x9f) return false;
  return !(cp >= 0xd800 && cp <= 0xdfff);
}

/** 解析 `ident := []struct{…}{…}` → 字段序 + 各行；非匿名 struct slice → `null`。 */
function readTable(docText: string, varDecl: SyntaxNode): GoTable | null {
  const identNode = childOfType(varDecl, 'DefName');
  if (!identNode) return null;
  const typed = childOfType(varDecl, 'TypedLiteral');
  if (!typed) return null;

  const sliceType = childOfType(typed, 'SliceType');
  const structType = sliceType ? childOfType(sliceType, 'StructType') : null;
  const structBody = structType ? childOfType(structType, 'StructBody') : null;
  if (!structBody) return null; // 命名 struct 类型（`[]tc{…}`）→ 不覆盖

  const fieldNames: string[] = [];
  for (const field of childrenOfType(structBody, 'FieldDecl')) {
    // `name, kind string` 一行多字段：按出现顺序展开
    for (const nameNode of childrenOfType(field, 'FieldName')) {
      fieldNames.push(rawText(docText, nameNode));
    }
  }
  if (fieldNames.length === 0) return null;

  const literal = childOfType(typed, 'LiteralValue');
  if (!literal) return null;
  const rows = childrenOfType(literal, 'Element')
    .map((element) => childOfType(element, 'LiteralValue'))
    .filter((row): row is SyntaxNode => row !== null);
  if (rows.length === 0) return null;

  return { ident: rawText(docText, identNode), fieldNames, rows };
}

/** `for _, loopVar := range tableIdent { … t.Run(loopVar.field, …) }` 的绑定。 */
function findNameBinding(
  docText: string,
  block: SyntaxNode,
  tableIdent: string,
): NameBinding | null {
  for (const forStatement of childrenOfType(block, 'ForStatement')) {
    const rangeClause = childOfType(forStatement, 'RangeClause');
    if (!rangeClause) continue;
    const ranged = childOfType(rangeClause, 'VariableName');
    if (!ranged || rawText(docText, ranged) !== tableIdent) continue;
    // `for _, tt := range …` → DefName 依次为 `_` / `tt`；取最后一个即循环变量
    const loopVars = childrenOfType(rangeClause, 'DefName');
    const loopVarNode = loopVars[loopVars.length - 1];
    if (!loopVarNode) continue;
    const loopVar = rawText(docText, loopVarNode);

    // 该循环体内 `t.Run(loopVar.field, …)` 的 field
    let bound: NameBinding | null = null;
    walk(forStatement, (node) => {
      if (bound || node.type.name !== 'CallExpr') return;
      const callee = node.firstChild;
      if (!callee || callee.type.name !== 'SelectorExpr') return;
      const receiver = childOfType(callee, 'VariableName');
      const method = childOfType(callee, 'FieldName');
      if (!receiver || !method || rawText(docText, method) !== 'Run') return;

      const args = childOfType(node, 'Arguments');
      if (!args) return;
      const firstArg = firstArgumentNode(args);
      if (!firstArg || firstArg.type.name !== 'SelectorExpr') return;
      const argVar = childOfType(firstArg, 'VariableName');
      const argField = childOfType(firstArg, 'FieldName');
      if (!argVar || !argField) return;
      if (rawText(docText, argVar) !== loopVar) return;
      bound = { loopVar, field: rawText(docText, argField) };
    });
    if (bound) return bound;
  }
  return null;
}

/** `Arguments` 内首个实参（跳过标点）。 */
function firstArgumentNode(args: SyntaxNode): SyntaxNode | null {
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (isPunctuationNode(child)) continue;
    return child;
  }
  return null;
}

/** 键式元素的键名（`Element → Key → VariableName`）；位置式 → `null`。 */
function elementKey(docText: string, element: SyntaxNode): string | null {
  const key = childOfType(element, 'Key');
  if (!key) return null;
  const nameNode = childOfType(key, 'VariableName');
  return nameNode ? rawText(docText, nameNode) : null;
}

/** 元素的值节点（跳过标点与 `Key`）。 */
function elementValue(element: SyntaxNode): SyntaxNode | null {
  for (let child = element.firstChild; child; child = child.nextSibling) {
    const kind = child.type.name;
    if (isPunctuationNode(child) || kind === 'Key') continue;
    return child;
  }
  return null;
}

/** 某一行的名字字段 → 净化后的子测试名；不可确定 → `null`。 */
function rowSubtestName(
  docText: string,
  row: SyntaxNode,
  fieldNames: string[],
  nameField: string,
): string | null {
  const elements = childrenOfType(row, 'Element');
  const keyed = elements.some((element) => elementKey(docText, element) !== null);

  let target: SyntaxNode | null = null;
  if (keyed) {
    target = elements.find((element) => elementKey(docText, element) === nameField) ?? null;
  } else {
    const index = fieldNames.indexOf(nameField);
    target = index >= 0 ? (elements[index] ?? null) : null;
  }
  if (!target) return null;

  const valueNode = elementValue(target);
  if (!valueNode || valueNode.type.name !== 'String') return null;

  const raw = stringValue(docText, valueNode);
  // 含转义 → 放弃（不做 Go 反转义；`\t`/`\n` 等直接影响净化结果）
  if (raw === null || raw.includes('\\')) return null;
  return sanitizeGoSubtestName(raw);
}

/**
 * 收集该 `Test*` 函数内部的**表格驱动子测试**（由 `discoverGoTests` 在其**单次遍历**中调用 ——
 * 不在这里另起一次全树 walk，那会让同一棵树被走两遍）。
 *
 * 产出 `{ name: '<父函数>/<净化后子名>', line: <表格该元素行>, lang: 'go' }`；
 * 「净化后重名」的组整组丢弃（见文件头本质限制 1）。
 */
export function collectTableSubtests(
  sd: SyntaxDoc,
  functionDecl: SyntaxNode,
  parentName: string,
  lineAt: LineAt,
): TestCaseInfo[] {
  const { docText } = sd;
  const block = childOfType(functionDecl, 'Block');
  if (!block) return [];

  const table = childrenOfType(block, 'VarDecl')
    .map((varDecl) => readTable(docText, varDecl))
    .find((candidate): candidate is GoTable => candidate !== null);
  if (!table) return [];

  const binding = findNameBinding(docText, block, table.ident);
  if (!binding) return [];

  const rows: TestCaseInfo[] = [];
  for (const row of table.rows) {
    const subtest = rowSubtestName(docText, row, table.fieldNames, binding.field);
    if (subtest === null) continue;
    rows.push({ name: `${parentName}/${subtest}`, line: lineAt(row.from), lang: 'go' });
  }

  // 净化后重名：运行时后缀 `#01`/`#02` 由碰撞顺序决定 → 静态不可预测 → 整组丢弃
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  return rows.filter((row) => counts.get(row.name) === 1);
}
