/**
 * Lezer 语法树访问的**共享工具**（语言无关）。
 *
 * 存在的意义：四种语言的 `syntax/<lang>.ts` 都需要「取子节点 / 找后代 / 取原文 / 取行号」，
 * 各写一遍就是 code-reuse 指南「模式 5」的副本漂移。这里只放**纯结构**操作，
 * 不放任何语言语义（如 Go 的 `sanitizeGoSubtestName` 属运行时语义，归 `syntax/go.ts`）。
 *
 * **依赖说明（重要）**：不直接 `import ... from '@lezer/common'`。
 * 本项目用 pnpm 严格 node_modules，`@lezer/common` 是传递依赖、**不在根 node_modules**，
 * 直接 import 会解析失败；而 `@codemirror/language`（直接依赖）又不 re-export `Tree` / `SyntaxNode`。
 * 故类型一律从 `syntaxTree` 的返回类型**派生**（见下），零清单/lockfile 改动。
 * 取 parser 同理：经 `@codemirror/lang-*.Language.parser`，不碰 `@lezer/*`。
 */
import { syntaxTree } from '@codemirror/language';

/** Lezer 语法树（`syntaxTree(state)` 的返回类型）。 */
export type SyntaxTree = ReturnType<typeof syntaxTree>;

/** Lezer 语法树节点。`topNode` 本身即 `SyntaxNode`，故由返回值派生而不引入 `@lezer/common`。 */
export type SyntaxNode = SyntaxTree['topNode'];

/** 原文切片（`from`..`to`）。 */
export function rawText(docText: string, node: SyntaxNode): string {
  return docText.slice(node.from, node.to);
}

/**
 * 行号查询器：**O(n) 建索引一次，O(log n) 查询**。
 *
 * **为什么必须用它、而不是「按位置扫一遍」**：`line = 数 docText[0..pos] 里的 \n` 这种写法
 * 单次是 O(pos)，而一次发现要按**每个**目标求行号 → 聚合 O(文件大小 × 目标数) = **二次方**。
 * 实测（vitest bench，2000 次查询）：5 KB → 4.8ms；44 KB → 49ms；179 KB → **193ms**，
 * 在 179 KB 的发现总耗时里占近一半。故本模块**不提供**逐次扫描版本，调用方必须先建索引 ——
 * 让「误用成二次方」在 API 层面不可能发生。
 */
export function createLineLookup(docText: string): (pos: number) => number {
  const lineStarts: number[] = [0];
  for (let i = 0; i < docText.length; i++) {
    if (docText.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1);
  }
  const starts = lineStarts;
  return (pos: number): number => {
    // 二分：最后一个 <= pos 的行首下标，+1 转 1-based（与 TestCaseInfo.line 同坐标系）
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** 第一个直接子节点中类型名为 `typeName` 者；无 → `null`。 */
export function childOfType(node: SyntaxNode, typeName: string): SyntaxNode | null {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.type.name === typeName) return c;
  }
  return null;
}

/** 全部直接子节点中类型名为 `typeName` 者（保持源码顺序）。 */
export function childrenOfType(node: SyntaxNode, typeName: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.type.name === typeName) out.push(c);
  }
  return out;
}

/**
 * 迭代式前序遍历（**显式栈，非递归**）。
 *
 * 刻意不用递归：语法树深度由源码决定（长链式表达式可轻易上千层），递归实现会撞栈上限。
 *
 * **性能提示**：本函数会访问**全部**节点。发现路径通常可以用 `walkPruned` 剪掉函数体等
 * 大块子树（实测那是节点量的大头）—— 只有在确实需要看整棵树时才用本函数。
 */
export function walk(root: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as SyntaxNode;
    visit(node);
    // 逆序压栈 → 出栈顺序即前序（源码顺序）
    const children: SyntaxNode[] = [];
    for (let c = node.firstChild; c; c = c.nextSibling) children.push(c);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

/**
 * **剪枝遍历**：默认下钻，但 `cut` 判定为真的子树**整体跳过**（该节点仍会被 `visit`）。
 *
 * 为什么是「默认下钻 + 剪枝」而不是「白名单容器」：白名单漏写一个容器类型 = **静默漏掉**
 * 该分支下的全部目标，而漏目标正是本项目最不愿接受的失效方式（见 design「宁可没有按钮，
 * 也不给错按钮」）。剪枝形式下，漏写只是**少省一点**，不会漏目标。
 *
 * **性能意义**：节点的绝大多数位于函数体内部，而「声明 / 表格 / 循环」等目标都挂在更外层。
 * 剪掉函数体后遍历量从 O(全部节点) 降到 O(声明数)，实测是复用增量树之后的**首要杠杆**。
 *
 * @param cut 返回 `true` 表示不进入该节点的子树。`parent` 用于区分「同名但语境不同」的节点
 *            （例如 Go 只保留 `Test*` 函数自己的 `Block`，其余函数体全部剪掉）。
 */
export function walkPruned(
  root: SyntaxNode,
  cut: (node: SyntaxNode, parent: SyntaxNode | null) => boolean,
  visit: (node: SyntaxNode) => void,
): void {
  // 两个并行栈而非 `{node,parent}` 对象：避免每节点一次对象分配
  const nodes: SyntaxNode[] = [root];
  const parents: Array<SyntaxNode | null> = [null];
  while (nodes.length > 0) {
    const node = nodes.pop() as SyntaxNode;
    const parent = parents.pop() as SyntaxNode | null;
    visit(node);
    if (cut(node, parent)) continue;
    // 逆序压栈 → 出栈顺序即前序
    const children: SyntaxNode[] = [];
    for (let c = node.firstChild; c; c = c.nextSibling) children.push(c);
    for (let i = children.length - 1; i >= 0; i--) {
      nodes.push(children[i]);
      parents.push(node);
    }
  }
}

/**
 * 语法树中的**标点 / 运算符节点名**（Lezer 把标点作为匿名子节点插入）。
 *
 * 上提到共享层的原因：`ts.ts` 的「取首个实参」与 `goTable.ts` 的「取元素值」都需要跳过标点，
 * 各自定义一份副本已经**轻微漂移**（一方多一个 `.`）—— 正是 code-reuse 指南「模式 5」的预测形态。
 * 用**并集**统一（多出的 `.` 在两个场景下都安全：`.` 只可能出现在字符串字面量内部，
 * 不会是独立子节点）。
 */
const PUNCTUATION_NODES: ReadonlySet<string> = new Set([
  '(',
  ')',
  ',',
  '{',
  '}',
  '[',
  ']',
  ';',
  ':',
  '.',
  '=>',
  '...',
]);

/** 该节点是否为标点 / 运算符（取「首个实参」「元素值」等场景需跳过）。 */
export function isPunctuationNode(node: SyntaxNode): boolean {
  return PUNCTUATION_NODES.has(node.type.name);
}

/** 三种字面量引号（Go/TS 用全，Rust/Java 只用前两种；由调用方决定接受哪种节点类型）。 */
const QUOTE_CHARS = new Set(['"', "'", '`']);

/**
 * 简单字符串字面量的**内容**（剥去配对引号）；不是形如 `<quote>…<quote>` 的字面量 → `null`。
 *
 * **刻意不做反转义**：各语言转义规则不同（且 Go 侧还需 `strconv.QuoteRune` 语义），
 * 由调用方按需限定 —— 例如 Go 表格子测试对含 `\` 的字面量直接放弃（见 design §7.8.3.3）。
 * 返回 `null` 表示「无法确定」，**绝不猜测**。
 */
export function stringValue(docText: string, node: SyntaxNode): string | null {
  const raw = rawText(docText, node);
  if (raw.length < 2) return null;
  const quote = raw[0];
  if (!QUOTE_CHARS.has(quote)) return null;
  if (raw[raw.length - 1] !== quote) return null;
  return raw.slice(1, -1);
}
