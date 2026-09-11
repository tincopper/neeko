/**
 * LSP hover 文档归一化（对齐 vscode-java 的 hover 渲染模型）。
 *
 * LSP 规范允许 `Hover.contents` 为三种形态：`MarkupContent`（{kind, value}）、
 * `MarkedString`（string 或 {language, value}）、以及它们的数组。jdtls 对 Java
 * 符号返回 `MarkedString[]`（签名围栏 + javadoc 文本），而 `@codemirror/lsp-client`
 * 的 `docToHTML` 只认 string / 单个 MarkupContent —— 数组直接渲染成空。
 *
 * 归一化策略（vscode-languageserver client 同款语义）：
 * - `string` → markdown（jdtls 的 javadoc 即 markdown 文本）；
 * - `{language, value}` → ```` ```language\nvalue\n``` ```` 围栏代码块；
 * - `{kind, value}` → 原样（已是 MarkupContent）；
 * - 数组 → 逐项归一后以空行拼接；
 * - 无法识别 → null（调用方不渲染 tooltip）。
 *
 * 纯函数、无 DOM 依赖，便于单测。
 */

export interface NormalizedHoverDoc {
  kind: 'markdown' | 'plaintext';
  value: string;
}

function normalizeOne(item: unknown): NormalizedHoverDoc | null {
  if (typeof item === 'string') {
    return item.trim() ? { kind: 'markdown', value: item } : null;
  }
  if (typeof item !== 'object' || item === null) return null;
  const doc = item as { kind?: unknown; value?: unknown; language?: unknown };
  if (typeof doc.value !== 'string' || !doc.value.trim()) return null;
  // MarkupContent：kind + value
  if (typeof doc.kind === 'string') {
    return { kind: doc.kind === 'plaintext' ? 'plaintext' : 'markdown', value: doc.value };
  }
  // MarkedString：{language, value} → 围栏代码块
  if (typeof doc.language === 'string') {
    return { kind: 'markdown', value: `\`\`\`${doc.language}\n${doc.value}\n\`\`\`` };
  }
  return null;
}

/**
 * 把 `Hover.contents` 的任意合法形态归一为单个 MarkupContent 形态；
 * 全部为空 / 无法识别时返回 null。
 */
export function normalizeHoverContents(contents: unknown): NormalizedHoverDoc | null {
  const parts = Array.isArray(contents) ? contents : [contents];
  const normalized = parts
    .map(normalizeOne)
    .filter((doc): doc is NormalizedHoverDoc => doc !== null);
  if (normalized.length === 0) return null;
  if (normalized.length === 1) return normalized[0] ?? null;
  return {
    kind: normalized.every((doc) => doc.kind === 'plaintext') ? 'plaintext' : 'markdown',
    value: normalized.map((doc) => doc.value).join('\n\n'),
  };
}
