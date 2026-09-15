/**
 * Shell 片段与任务标识（语言无关的纯工具）。
 *
 * **换行/shell 语义所有权**：引号规则由本模块单点持有 —— 命令字符串在**前端**拼装，
 * 但执行 shell 由统一执行门面按项目环境（Local `sh -c`/`cmd /c`、WSL、SSH）选定。
 * 因此这里只提供 POSIX 单引号转义；已知限制见 `languages/rust/commands.ts` 的
 * `RUSTC_BOOTSTRAP` env 前缀说明（Windows 本地 cmd 不支持 `VAR=x cmd` 语法）。
 */
import type { TestCaseInfo } from '../syntax/contract';

/** POSIX 单引号转义：内嵌 `'` → `'\''`。 */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * 按需引用（shlex 风格）：仅当 token 含**不安全字符**时才 `shQuote`。
 *
 * 命令要显示在 Task Console 且可复制 —— 全量引用（`'cargo' 'test' '--package'`）虽正确但
 * 不可读；LSP 来的 token 多为 flag / 路径，绝大多数无需引用。安全集与 Python `shlex.quote`
 * 一致（字母数字 + `@%+=:,./-`），因此 `::`（Rust 测试路径）、`=`（`-gcflags=all=-N -l` 类）
 * 均不引用；含空格 / 引号 / shell 元字符的一律单引号包裹。
 */
export function shellToken(token: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(token) && token !== '' ? token : shQuote(token);
}

/** 任务 Console 会话 configId：按 run/debug + 语言 + 文件 + 用例名隔离标签页。 */
export function buildTestConfigId(
  kind: 'run' | 'debug',
  testCase: TestCaseInfo,
  relPath: string,
): string {
  return `testcase:${kind}:${testCase.lang}:${relPath}:${testCase.name}`;
}
