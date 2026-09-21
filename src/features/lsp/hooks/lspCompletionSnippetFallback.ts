import { snippet } from '@codemirror/autocomplete';
import type { Completion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';

import { buildFunctionSnippet } from './completionRenderer';

/**
 * 本函数读取的 CM6 `Completion` 库类型未建模的字段（`kind` / `insertTextFormat` /
 * `textEdit` 等仅存在于 `@codemirror/lsp-client` 构造的 option 字面量，库的
 * `Completion` 接口不含）。用窄接口只声明所需字段，替代裸 `any`。
 */
interface SnippetCandidate {
  label?: string;
  apply?: unknown;
  insertTextFormat?: number;
  kind?: number;
  textEdit?: { newText?: string };
  textEditText?: string;
  insertText?: string;
}

/** LSP CompletionItemKind values that benefit from parameter auto-fill. */
const FUNCTION_KINDS: Record<number, true> = { 2: true, 3: true, 4: true };

/**
 * Upgrade a function-like completion whose insert text is a bare name into a
 * snippet that fills its parameters. Mirrors the `@codemirror/lsp-client`
 * `insertTextFormat === 2` path so every function completion gets IDEA-style
 * argument placeholders — even when the server omits a snippet.
 *
 * ⚠️ 当前**不生效**（2026-09-18 核实）：入参是 `@codemirror/lsp-client` 构造的
 * CM6 `Completion`，它只带 `label` / `displayLabel` / `type` / `apply` / `info`
 * 等字段——**从不携带 `kind` / `insertTextFormat`**（见 dist 里 `option` 字面量）。
 * 因此上面两处判断恒为假、函数必定早退。保留现状（不激活）是刻意的：激活会为
 * 「服务器已给 snippet」或「自带 additionalTextEdits」的项重装 apply，从而**丢
 * 掉自动导入的 import 编辑**。要恢复该特性，判据必须换成 CM6 侧的 `type`，并且
 * 保留 `item.apply != null` 让行护栏。详见任务 09-18-lsp-auto-import-diagnostics。
 */
export function maybeAttachSnippetFallback(item: SnippetCandidate): void {
  // 上游/补丁已经装好 apply = 插入文本与附加编辑（自动导入）的决策已定，覆盖它
  // 会静默丢掉 import 编辑或改变插入文本 —— 必须让行（护栏，见下方"本函数当前
  // 不生效"的说明）。
  if (item.apply != null) return;
  // Server already provided a snippet (or we must not touch its intent).
  if (item.insertTextFormat === 2) return;
  // Only function-like kinds benefit from parameter auto-fill.
  if (FUNCTION_KINDS[item.kind ?? -1] !== true) return;

  // The text the server would insert (same precedence as lsp-client).
  const text = item.textEdit?.newText ?? item.textEditText ?? item.insertText ?? item.label;
  if (!text) return;
  const hasExplicitInsert =
    item.textEdit?.newText != null || item.textEditText != null || item.insertText != null;

  // Extract a function name from whatever text would be inserted.
  let funcName: string | null = null;
  if (text.includes('(')) {
    // Already a call signature — only override when the server gave NO
    // insertText (otherwise it would insert the raw label, which is worse
    // than a snippet). When overriding, take the leading name.
    if (hasExplicitInsert) return;
    const m = /^([A-Za-z_$][\w$]*)\(/.exec(text);
    if (m) funcName = m[1];
  } else {
    const m = /^([A-Za-z_$][\w$]*)$/.exec(text);
    if (m) funcName = m[1];
  }
  if (!funcName) return;

  const snippetText = buildFunctionSnippet(funcName, item.label ?? '');
  item.apply = (view: EditorView, completion: Completion, from: number, to: number) =>
    snippet(snippetText)(view, completion, from, to);
}
