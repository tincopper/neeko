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
 * - Java：测试注解行（`@Test` / `@ParameterizedTest` / `@RepeatedTest`，注解名以 `Test`
 *   结尾，对齐 Zed runnables.scm 的 `Test$` 文本匹配）→ 其后第一个 `void <name>(` 方法行
 *   （跳过空行/注释/其他注解），`name` 取方法名，`line` 取注解行。**声明局限**（文本级、
 *   无 AST）：`@ParameterizedTest`/`@Nested` 不建模到 invocation 级——参数化/嵌套按方法
 *   名单用例处理（方法名做用例名）；`@TestFactory`/`@TestTemplate` 不以 `Test` 结尾不命中；
 *   自定义组合注解（元注解）无法识别（业界靠 JDT 语义解析，见 research/test-debug-matrix-java.md）。
 */

export interface TestCaseInfo {
  name: string;
  /** 1-based line of the test declaration (attribute line for Rust/Java). */
  line: number;
  lang: 'ts' | 'rust' | 'go' | 'java';
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

/**
 * Java 测试注解行（行首）：注解简单名以 `Test` 结尾 —— `@Test` / `@ParameterizedTest` /
 * `@RepeatedTest`（对齐 Zed runnables.scm 的 `Test$` 文本匹配）。带参形态
 * `@Test(timeout = 500)` 命中 `\b`（`(` 处字边界）；FQN 注解（`@org.junit...Test`）
 * 不命中（惯例简写，行首匹配即足够）。非 JUnit 注解（`@BeforeEach`/`@DisplayName` 等）
 * 不以 `Test` 结尾，天然排除。
 */
const JAVA_TEST_ANNOTATION = /^@([\w$]*Test)\b/;

/**
 * Java 测试方法声明行（行首）：任意修饰符（public/protected/private/static/final/…）+
 * 可选泛型（`<T>`）后跟 `void <name>(`。仅 `void` 返回类型（JUnit 测试方法约定），
 * 非行首/返回值非 void 不匹配。
 */
const JAVA_TEST_METHOD_LINE =
  /^(?:(?:public|protected|private|static|final|synchronized|native|strictfp)\s+)*(?:<\s*[^>]*\s*>\s+)?void\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;

/** TS/JS 测试文件命名：`*.test.*` / `*.spec.*`（本语言专属，不含其它语言后缀）。 */
export function isTsTestFile(fileName: string): boolean {
  return /\.(test|spec)\.[^./]+$/.test(fileName);
}

/** 测试文件判定（跨语言）：TS `*.test.*`/`*.spec.*`；`*_test.go`；Rust 需含
 *  `#[test]`/`#[tokio::test]`；Java `*Test.java`/`*Tests.java`，或（有内容时）含 `@Test`。 */
export function isTestFile(fileName: string, docText?: string): boolean {
  if (isTsTestFile(fileName)) return true;
  if (fileName.endsWith('_test.go')) return true;
  if (fileName.endsWith('.rs')) {
    if (docText === undefined) return false;
    return docText.includes('#[test]') || docText.includes('#[tokio::test');
  }
  if (fileName.endsWith('.java')) {
    if (/(?:Test|Tests)\.java$/.test(fileName)) return true;
    if (docText === undefined) return false;
    return docText.includes('@Test');
  }
  return false;
}

/** TS/JS：逐行匹配 `test(`/`it(`，忽略注释行与非行首调用。 */
export function parseTsCases(docText: string): TestCaseInfo[] {
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
export function parseRustCases(docText: string): TestCaseInfo[] {
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
export function parseGoCases(docText: string): TestCaseInfo[] {
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
 * Java：测试注解行 → 向下找第一个 `void <name>(` 方法行（跳过空行/注释/其他注解行）。
 * 结果按行号升序、每行至多一个用例；`line` 取注解行（gutter 图标渲染在注解行，与 Rust 属性行同惯例）。
 * 参数化/嵌套按方法名单用例处理（invocation 级建模为声明局限，见文件头）。
 */
export function parseJavaCases(docText: string): TestCaseInfo[] {
  const cases: TestCaseInfo[] = [];
  const lines = docText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!JAVA_TEST_ANNOTATION.test(trimmed)) continue;
    const line = i + 1;
    let name: string | null = null;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (
        next.length === 0 ||
        next.startsWith('//') ||
        next.startsWith('/*') ||
        next.startsWith('*') ||
        next.startsWith('@')
      ) {
        continue;
      }
      const m = JAVA_TEST_METHOD_LINE.exec(next);
      if (m) name = m[1];
      break;
    }
    if (name) cases.push({ name, line, lang: 'java' });
  }
  return cases;
}

// 语言分发已收归 `runLanguages.ts`（可运行语言注册表）；本模块只提供
// 各语言的纯解析器与 `isTestFile` 命名/内容判定。
