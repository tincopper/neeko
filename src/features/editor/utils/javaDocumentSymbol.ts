/**
 * Java `@Nested` 嵌套链推导（纯函数，无副作用）。
 *
 * 背景：`deriveJavaFqcn(relPath)` 从**文件路径**推 FQCN，对 `@Nested` 内层类失效 —— 现状会发出
 * `com.example.AppTest#testNested`，而该方法实际在嵌套类里，真机报
 * `PreconditionViolationException: Could not find method with name [testNested] in class [com.example.AppTest]`；
 * 正确形态是 `com.example.AppTest$InnerCases#testNested`（真机已验证，见 design §7.7.1）。
 *
 * 数据源 = 核心 jdt.ls 的 `textDocument/documentSymbol`，**兼容两种线上形状**：
 * - **扁平** `SymbolInformation[]`（`location.range` + `containerName`）—— **Neeko 现状**：
 *   `build_client_capabilities()` 未声明 `documentSymbol` / `hierarchicalDocumentSymbolSupport`，
 *   实测 jdt.ls 走这条（design §7.7.3.1）；
 * - **层级** `DocumentSymbol[]`（`range`/`selectionRange` + `children`）—— 声明该 capability 时；
 *   遍历时自行推出 `containerName`，**归一为同一张扁平表**。
 *
 * 为什么必须用 `containerName` 向上走而不是按 `range` 包含判定：扁平形状里类符号的
 * `location.range` 是**名字范围**（`L1` 起始 = 其声明行），不含类体 → range 包含会全部判否。
 *
 * 两条链路归一的意义：链推导只有**一条**实现，不给「同一谓词两套副本」留口子
 * （`guides/code-reuse-thinking-guide.md` 模式 5）。
 */

/** LSP `SymbolKind.Class`：唯一能作为 JUnit `@Nested` 容器的种类。 */
const SYMBOL_KIND_CLASS = 5;

/** LSP `SymbolKind.Method`。 */
const SYMBOL_KIND_METHOD = 6;

/** 归一化后的符号（只保留链推导所需字段）。 */
export interface JavaSymbol {
  /** 方法名已剥去 `()`（jdt.ls 的 method 名为 `"testAdd()"` 形态）；类名原样。 */
  name: string;
  kind: number;
  /** 符号名字所在行，**1-based**（与 `TestCaseInfo.line` 同一坐标系，避免边界换算）。 */
  line: number;
  /** 直属容器名（扁平形状原生；层级形状由树推得）。顶层类为文件名（如 `AppTest.java`）。 */
  containerName?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 剥方法名的 `()` 尾缀（类名不受影响）。 */
function normalizeName(name: string): string {
  return name.endsWith('()') ? name.slice(0, -2) : name;
}

function readLine(start: unknown): number | null {
  if (!isRecord(start)) return null;
  const line = start['line'];
  return typeof line === 'number' && Number.isFinite(line) ? line : null;
}

/**
 * 解析 `documentSymbol` 载荷 → 归一化扁平表。畸形项**丢弃**（不猜），
 * 与 `runnables/runnable.ts::parseRunnables` 同姿态 —— 结构化数据一旦猜错就会喂出错误选择器。
 */
export function parseJavaSymbols(raw: unknown): JavaSymbol[] {
  if (!Array.isArray(raw)) return [];
  const out: JavaSymbol[] = [];

  const visit = (nodes: unknown[], inheritedContainer: string | undefined): void => {
    for (const node of nodes) {
      if (!isRecord(node)) continue;
      const rawName = node['name'];
      const kind = node['kind'];
      if (typeof rawName !== 'string' || typeof kind !== 'number') continue;
      const name = normalizeName(rawName);

      // 扁平形状：location.range.start.line + containerName
      const location = node['location'];
      if (isRecord(location)) {
        const line = readLine(isRecord(location['range']) ? location['range']['start'] : null);
        if (line === null) continue;
        const container = node['containerName'];
        out.push({
          name,
          kind,
          line: line + 1,
          ...(typeof container === 'string' ? { containerName: container } : {}),
        });
        continue;
      }

      // 层级形状：selectionRange（名字）优先，其次 range（整块）
      const range = node['range'];
      if (!isRecord(range)) continue;
      const selection = node['selectionRange'];
      const start = isRecord(selection) ? selection['start'] : range['start'];
      const line = readLine(start);
      if (line === null) continue;
      out.push({
        name,
        kind,
        line: line + 1,
        ...(inheritedContainer !== undefined ? { containerName: inheritedContainer } : {}),
      });
      const children = node['children'];
      if (Array.isArray(children)) visit(children, name);
    }
  };

  visit(raw, undefined);
  return out;
}

/**
 * 方法 → **内层类链**（外→内，**不含最外层类**）。
 *
 * 最外层类由 `deriveJavaFqcn(relPath)` 提供，这里刻意不重复携带 —— 否则同一个 FQCN 会有
 * 两个来源，必然漂移（code-reuse 模式 5）。
 *
 * `annotationLine` 为源码侧的测试注解行（`TestCaseInfo.line`）：同名方法可能出现在多个类里，
 * 用「名字行 ≥ 注解行的最近者」定位，避免串味。无法确定 → 空链（调用方降级为现状表单）。
 */
export function nestedClassPath(
  symbols: readonly JavaSymbol[],
  methodName: string,
  annotationLine: number,
): string[] {
  const classByName = new Map<string, JavaSymbol>();
  for (const symbol of symbols) {
    if (symbol.kind !== SYMBOL_KIND_CLASS) continue;
    if (!classByName.has(symbol.name)) classByName.set(symbol.name, symbol);
  }

  const candidates = symbols.filter(
    (s) => s.kind === SYMBOL_KIND_METHOD && s.name === methodName && s.line >= annotationLine,
  );
  if (candidates.length === 0) return [];
  const method = candidates.reduce((a, b) => (b.line < a.line ? b : a));

  // 沿 containerName 向上收集本文件内的类（内→外）；`seen` 防畸形载荷成环
  const innerToOuter: string[] = [];
  const seen = new Set<string>();
  let current = method.containerName;
  while (current !== undefined && !seen.has(current)) {
    const container = classByName.get(current);
    if (!container) break; // 容器不在本文件的类里（顶层类的 fileName / 隐式类）→ 到头
    seen.add(current);
    innerToOuter.push(current);
    current = container.containerName;
  }

  innerToOuter.reverse(); // 外→内
  innerToOuter.shift(); // 去掉最外层类（交由 deriveJavaFqcn）
  return innerToOuter;
}
