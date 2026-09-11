/**
 * 每语言「最小语法模式」的**唯一落点**（函数/方法声明、main 入口形态）。
 *
 * 存在理由（实证，2026-09-11 线上 bug）：同一件事此前被写过两遍并漂移 ——
 * `utils/testCases.ts` 的 `RUST_FN_LINE` 支持 `async`，而 `utils/mainEntries.ts` 的
 * `RUST_MAIN_LINE` 不支持，导致 `#[tokio::main] async fn main()` 没有 Run/Debug 按钮。
 * 现在「Rust 函数声明」只有一个模式，两个消费方共用：**改语法形态只改这里**。
 *
 * 边界（刻意不做的事）：
 * - 只描述「形如」，不做语义判断（是不是 main / 是不是 `TestXxx` 由消费方决定）；
 * - 不做 AST：不处理宏生成（`macro_rules!` / `include!`）、跨行签名；
 * - **均以行首 `^` 锚定且不吞前导空白**：消费方负责 `trim()` / `trimStart()` 后匹配
 *   （既有消费方 `testCases.ts` / `mainEntries.ts` 都是这么做的）；
 * - 不引入依赖；模式均**非 global**（`RegExp.exec` 无 lastIndex 状态，可安全复用）。
 */

// ── Rust ────────────────────────────────────────────────────────────────────

/**
 * Rust 函数前置修饰符：可见性（可带括号：`pub` / `pub(crate)` / `pub(super)` /
 * `pub(in path)`）+ `async` + `unsafe` + `extern "ABI"`。
 * 这些修饰符是入口/用例漏识别的历史高发区，单独成串以便一处维护。
 */
const RUST_FN_MODIFIERS =
  '(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:extern\\s+"[^"]*"\\s+)?';

/**
 * Rust 函数声明（行首，`g1` = 函数名）。
 * 同时服务两类消费方：取测试函数名（`#[test]` 后一行）与判 main 入口（`g1 === 'main'`）。
 */
export const RUST_FN_DECL = new RegExp(`^${RUST_FN_MODIFIERS}fn\\s+([A-Za-z_][A-Za-z0-9_]*)`);

// ── Go ─────────────────────────────────────────────────────────────────────

/**
 * Go 函数声明（行首，`g1` = 函数名）。
 * **不匹配方法接收者形态**（`func (s *Suite) TestX()`）——保留既有语义：接收者上的
 * 方法不参与「测试用例 / main 入口」检测。
 */
export const GO_FUNC_DECL = /^func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

// ── Java ───────────────────────────────────────────────────────────────────

/** Java 修饰符（不含 `static`）。 */
const JAVA_MODIFIERS_NO_STATIC =
  '(?:public|protected|private|final|abstract|synchronized|native|strictfp|default)\\s+';

/** Java 修饰符（含 `static`）：通用方法声明用。 */
const JAVA_MODIFIERS = `(?:public|protected|private|static|final|abstract|synchronized|native|strictfp|default)\\s+`;

/**
 * Java 方法声明（行首，`g1` = 方法名）：任意修饰符 + 可选泛型 + `void <name>(`。
 * 仅 `void` 返回类型（JUnit 测试方法约定）；非行首 / 返回值非 void 不匹配。
 */
export const JAVA_VOID_METHOD_DECL = new RegExp(
  `^(?:${JAVA_MODIFIERS})*(?:<\\s*[^>]*\\s*>\\s+)?void\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(`,
);

/**
 * Java main 声明（行首，`g1` = `main`）：`static void main(String[] args)` /
 * `String... args` / `final String[] args`（形参可带 `final`）。`static` 与其他
 * 修饰符**可交错**（`public static final void main(...)` 同样成立），因此不允许把
 * `static` 塞进通用修饰符组里吞掉。
 *
 * 刻意把 `main` 也captured 成 `g1`：三个模式统一「`g1` = 入口/用例名」，消费方
 * （`mainEntries.collectEntries`）无需为 Java 特例化。
 */
export const JAVA_MAIN_DECL = new RegExp(
  `^(?:${JAVA_MODIFIERS_NO_STATIC})*static\\s+(?:${JAVA_MODIFIERS_NO_STATIC})*void\\s+(main)\\s*\\(\\s*(?:final\\s+)?String\\s*(?:\\[\\]\\s*|\\s*\\.\\.\\.\\s*)[A-Za-z_$][A-Za-z0-9_$]*\\s*\\)`,
);
