/**
 * 测试用例的**类型与文件命名谓词**（不包含检测逻辑）。
 *
 * 检测已全部迁移到 **Lezer AST**，按语言实现于 `syntax/<lang>.ts`
 * （`discoverTsTests` / `discoverRustTests` / `discoverGoTests` / `discoverJavaTests`），
 * 由 `utils/runLanguages.ts` 统一分发 —— 机制唯一，各语言不再各写行正则。
 *
 * **为什么迁移**：此前四语言各有一份「行首正则」检测（声明形态集中在 `languageSyntax.ts`）。
 * 该类实现有两类固有缺陷：
 * 1. **漂移**：同一形态被抄成多份副本，改一处漏一处（`languageSyntax.ts` 的存在本身就是
 *    `#[tokio::main] async fn main()` 漏识别那个线上 bug 的补丁）；
 * 2. **能力天花板**：表格驱动子测试、嵌套 case、字符串/注释内的假调用等，逐行正则无法安全处理。
 *
 * 本模块保留的只是**与解析无关**的部分：跨语言的文件名判定（用例类型见 `syntax/contract.ts`）。
 */
/** 类型定义已下沉到 `syntax/contract.ts`（低层持有类型）；此处再导出以保持既有导入路径。 */
export type { TestCaseInfo } from '../syntax/contract';

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
/**
 * Go：逐行匹配 `func TestXxx(`，忽略注释行与非行首与 `func BenchmarkXxx`。
 * 结果按行号升序、每行至多一个用例；`line` 取函数声明行。
 */
/**
 * Java：测试注解行 → 向下找第一个 `void <name>(` 方法行（跳过空行/注释/其他注解行）。
 * 结果按行号升序、每行至多一个用例；`line` 取注解行（gutter 图标渲染在注解行，与 Rust 属性行同惯例）。
 * 参数化/嵌套按方法名单用例处理（invocation 级建模为声明局限，见文件头）。
 */
// 语言分发已收归 `runLanguages.ts`（可运行语言注册表）；本模块只提供
// 各语言的纯解析器与 `isTestFile` 命名/内容判定。
