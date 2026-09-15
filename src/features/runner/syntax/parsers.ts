/**
 * `RunLang` → Lezer parser 的唯一映射。
 *
 * **为什么需要**：AST 发现（`syntax/<lang>.ts`）需要「原文 → 语法树」的兜底入口
 * （生产走 `syntaxTree(state)` 复用增量树；纯函数/单测无 state 时在此解析）。
 *
 * **依赖约束**：一律经 `@codemirror/lang-*`（**直接依赖**）导出的 `*Language.parser`；
 * **禁止**直接 import `@lezer/*`（pnpm 严格 node_modules 下是传递依赖，解析会失败）。
 */
import { goLanguage } from '@codemirror/lang-go';
import { javaLanguage } from '@codemirror/lang-java';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { rustLanguage } from '@codemirror/lang-rust';

import type { RunLang } from './contract';
import type { SyntaxTree } from './lezer';

type Parser = { parse(input: string): SyntaxTree };

const PARSERS: Record<RunLang, Parser> = {
  /*
   * TS 侧统一用**基础 JS 语法**（而编辑器对 `.tsx` 挂载的是 `javascript({ jsx, typescript })`）。
   * 这是**刻意的方言简化**，已实测：`.test.tsx`（含类型注解 + JSX）在基础 JS 语法下仍能正确
   * 识别 `test(...)`/`it(...)`（错误恢复保留了语句结构，而发现只依赖**调用语句结构**，不需要
   * 类型/JSX 语义）。若将来出现漏检，再按扩展名细分方言（`.tsx`→`tsxLanguage` 等）。
   */
  ts: javascriptLanguage.parser,
  rust: rustLanguage.parser,
  go: goLanguage.parser,
  java: javaLanguage.parser,
};

/** 该语言的 Lezer parser。 */
export function parserFor(lang: RunLang): Parser {
  return PARSERS[lang];
}
