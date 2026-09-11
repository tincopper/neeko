/**
 * main 入口检测纯函数：编辑器文本 → 可运行的 main 入口列表（Go / Rust / Java）。
 *
 * 与 testCases.ts 同族：行首正则，忽略注释/字符串误报（保守：只认行首声明）。
 * 供 gutter main-run 贡献消费（run-only；Debug 走既有 DebugRunButton / dap_discover_entries）。
 */

export type MainLang = 'go' | 'rust' | 'java';

export interface MainEntry {
  /** 1-based 行号（main 声明行）。 */
  line: number;
  language: MainLang;
}

/** Go `func main()` 声明行（行首；`func main (` 兼容）。 */
const GO_MAIN_LINE = /^func\s+main\s*\(/;

/** Rust `fn main()` 声明行（行首）。 */
const RUST_MAIN_LINE = /^fn\s+main\s*\(/;

/**
 * Java `main` 方法声明行（行首，任意修饰符前缀）：
 * `public static void main(String[] args)` / `String... args` / `final String[] args`。
 * 只认 `static void main(`，非行首 / 非 void 不匹配。`static` 单独出现两次（修饰符
 * 组不含它 + 必选 `static void`）——`public static void main` 由修饰符组吃 `public`。
 */
const JAVA_MAIN_LINE =
  /^(?:(?:public|protected|private|final|synchronized|native)\s+)*static\s+void\s+main\s*\(\s*String\s*(?:\[\]\s*|\s*\.\.\.\s*)[A-Za-z_$][A-Za-z0-9_$]*\s*\)/;

/** 注释行（`//`、`#`、`/*`、`*`）。 */
function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*');
}

function collect(lines: string[], re: RegExp, language: MainLang): MainEntry[] {
  const out: MainEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (isCommentLine(trimmed)) continue;
    if (re.test(trimmed)) out.push({ line: i + 1, language });
  }
  return out;
}

/** Go `.go`：`func main` 入口。结果按行号升序、每行至多一个。 */
export function parseGoMain(docText: string): MainEntry[] {
  return collect(docText.split('\n'), GO_MAIN_LINE, 'go');
}

/** Rust `.rs`：`fn main` 入口。 */
export function parseRustMain(docText: string): MainEntry[] {
  return collect(docText.split('\n'), RUST_MAIN_LINE, 'rust');
}

/** Java `.java`：`static void main` 入口。 */
export function parseJavaMain(docText: string): MainEntry[] {
  return collect(docText.split('\n'), JAVA_MAIN_LINE, 'java');
}

// 语言分发已收归 `runLanguages.ts`（可运行语言注册表）。
