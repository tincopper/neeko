/**
 * 测试用例检测纯函数：编辑器文本 → 用例信息列表。
 *
 * 按行首匹配 + 简单 trim，不引入 AST 依赖（性能红线：配合防抖调用，不每键全文件重解析）。
 * - TS/JS（`*.test.*` / `*.spec.*`）：`test('name', …` / `it('name', …` 行（含 `.only`/`.skip` 等
 *   单调用修饰符；`test.each(table)(…)` 双调用形态 MVP 不支持）。
 * - Rust：`#[test]` / `#[tokio::test]` 属性行 → 其后第一个 `fn <name>`（跳过空行/注释/其他属性），
 *   `name` 取 fn 名，`line` 取属性行（gutter 图标渲染在属性行）。
 * - Go：`func TestXxx(t *testing.T)` 行首（文本正则，无 AST；首期只做 Test，
 *   `func BenchmarkXxx` 刻意不检测——`-run` 过滤与 benchmark 名不匹配，执行无意义（YAGNI）；
 *   对齐 vscode-go 局限：不识别 `t.Run` 子测试 / 方法接收者 / 组合测试形态）。
 */

export interface TestCaseInfo {
  name: string;
  /** 1-based line of the test declaration (attribute line for Rust). */
  line: number;
  lang: 'ts' | 'rust' | 'go';
}

/** TS/JS test-call pattern: line must start (after trim) with test/it + optional single modifiers. */
const TS_TEST_LINE =
  /^(?:test|it)(?:\.(?:only|skip|concurrent|todo|fails))*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;

const RUST_FN_LINE = /^(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/;

/**
 * Go test 函数行（行首正则）：`func TestXxx(`。
 * 首字母大写（导出）是 Go 惯例但不是语法强制——检测不过滤大小写，只要求
 * `Test` 前缀 + 形如函数签名；方法接收者（`func (s *Suite) Test…`）
 * 与非行首引用不匹配（`\s+` 后必须是 `Test` 字面量）。
 * `func BenchmarkXxx` 不匹配（见文件头 YAGNI 说明：`-run` 与 benchmark 名不匹配）。
 */
const GO_TEST_FN_LINE = /^func\s+(Test[A-Za-z0-9_]*)\s*\(/;

/** 测试文件判定：`*.test.*` / `*.spec.*`；`*_test.go`；Rust 文件需含 `#[test]`/`#[tokio::test]`。 */
export function isTestFile(fileName: string, docText?: string): boolean {
  if (/\.(test|spec)\.[^./]+$/.test(fileName)) return true;
  if (fileName.endsWith('_test.go')) return true;
  if (fileName.endsWith('.rs')) {
    if (docText === undefined) return false;
    return docText.includes('#[test]') || docText.includes('#[tokio::test');
  }
  return false;
}

/** TS/JS：逐行匹配 `test(`/`it(`，忽略注释行与非行首调用。 */
function parseTsCases(docText: string): TestCaseInfo[] {
  const cases: TestCaseInfo[] = [];
  const lines = docText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.length === 0
    ) {
      continue;
    }
    const m = TS_TEST_LINE.exec(trimmed);
    if (!m) continue;
    cases.push({ name: m[2].replace(/\\(['"`\\])/g, '$1'), line: i + 1, lang: 'ts' });
  }
  return cases;
}

/** Rust：属性行 → 向下找第一个 `fn <name>`（跳过空行/注释/其他属性行）。 */
function parseRustCases(docText: string): TestCaseInfo[] {
  const cases: TestCaseInfo[] = [];
  const lines = docText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Rust test attribute line: `#[test]` / `#[tokio::test]` / `#[tokio::test(...)]`
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('#[test]') && !trimmed.startsWith('#[tokio::test')) continue;
    const line = i + 1;
    let name: string | null = null;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (next.length === 0 || next.startsWith('//') || next.startsWith('#[')) continue;
      const fnMatch = RUST_FN_LINE.exec(next);
      if (fnMatch) name = fnMatch[1];
      break;
    }
    if (name) cases.push({ name, line, lang: 'rust' });
  }
  return cases;
}

/**
 * Go：逐行匹配 `func TestXxx(`，忽略注释行与非行首与 `func BenchmarkXxx`。
 * 结果按行号升序、每行至多一个用例；`line` 取函数声明行。
 */
function parseGoCases(docText: string): TestCaseInfo[] {
  const cases: TestCaseInfo[] = [];
  const lines = docText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    const m = GO_TEST_FN_LINE.exec(trimmed);
    if (!m) continue;
    const name = m[1];
    cases.push({ name, line: i + 1, lang: 'go' });
  }
  return cases;
}

/**
 * 解析文档中的测试用例。非测试 TS 文件返回 `[]`；Rust 文件按属性行解析
 * （无 `#[test]` 自然返回空）；Go 按 `func TestXxx` 行解析。结果按行号升序、每行至多一个用例。
 */
export function parseTestCases(fileName: string, docText: string): TestCaseInfo[] {
  if (fileName.endsWith('.rs')) return parseRustCases(docText);
  if (fileName.endsWith('_test.go')) return parseGoCases(docText);
  if (isTestFile(fileName)) return parseTsCases(docText);
  return [];
}
