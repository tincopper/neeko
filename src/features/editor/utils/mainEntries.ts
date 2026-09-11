/**
 * main 入口检测纯函数：编辑器文本 → 可运行的 main 入口列表（Go / Rust / Java）。
 *
 * 与 testCases.ts 同族：行首模式，忽略注释行（保守：只认行首声明）。
 * **声明形态来自 `languageSyntax.ts` 单一事实源**（曾经各写一份并漂移：测试名模式支持
 * `async` 而 main 模式不支持 → `#[tokio::main] async fn main()` 没有 Run/Debug 按钮）。
 * 供 gutter main-run 贡献消费（run-only；Debug 走既有 DebugRunButton / dap_discover_entries）。
 */

import { GO_FUNC_DECL, JAVA_MAIN_DECL, RUST_FN_DECL } from './languageSyntax';

export type MainLang = 'go' | 'rust' | 'java';

export interface MainEntry {
  /** 1-based 行号（main 声明行）。 */
  line: number;
  language: MainLang;
}

/**
 * 注释行（`//`、`#`、`/*`、`*`）。`#` 覆盖 Rust 属性行（`#[tokio::main]` 本身不是
 * 入口声明，入口在下一行的 `fn main`）。
 */
function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*');
}

/**
 * 行扫描：`decl` 的 `g1` = 函数/方法名（三个模式统一此契约），`isEntry` 判定是否入口
 * ——各语言只差这一条谓词。消费方负责 `trimStart()`（模式锚定行首且不吞前导空白）。
 */
function collectEntries(
  lines: string[],
  decl: RegExp,
  isEntry: (name: string) => boolean,
  language: MainLang,
): MainEntry[] {
  const out: MainEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (isCommentLine(trimmed)) continue;
    const name = decl.exec(trimmed)?.[1];
    if (name !== undefined && isEntry(name)) out.push({ line: i + 1, language });
  }
  return out;
}

const isMain = (name: string): boolean => name === 'main';

/** Go `.go`：`func main` 入口。结果按行号升序、每行至多一个。 */
export function parseGoMain(docText: string): MainEntry[] {
  return collectEntries(docText.split('\n'), GO_FUNC_DECL, isMain, 'go');
}

/** Rust `.rs`：`fn main` 入口（含 `async` / `pub(crate)` / `unsafe` / `extern "C"` 修饰符）。 */
export function parseRustMain(docText: string): MainEntry[] {
  return collectEntries(docText.split('\n'), RUST_FN_DECL, isMain, 'rust');
}

/** Java `.java`：`static void main(String…)` 入口。 */
export function parseJavaMain(docText: string): MainEntry[] {
  return collectEntries(docText.split('\n'), JAVA_MAIN_DECL, isMain, 'java');
}

// 语言分发已收归 `runLanguages.ts`（可运行语言注册表）。
