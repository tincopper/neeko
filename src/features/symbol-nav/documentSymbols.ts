/**
 * Parse LSP textDocument/documentSymbol responses (DocumentSymbol tree or SymbolInformation[]).
 */

export interface FlatSymbol {
  name: string;
  kind: number;
  detail?: string;
  /** 0-based line */
  line: number;
  /** 0-based character */
  character: number;
  depth: number;
  containerName?: string;
}

/** LSP SymbolKind names (1-based enum). */
const KIND_LABELS: Record<number, string> = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter",
};

export function symbolKindLabel(kind: number): string {
  return KIND_LABELS[kind] ?? "Symbol";
}

function isRange(v: unknown): v is { start: { line: number; character: number } } {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const start = r.start as Record<string, unknown> | undefined;
  return (
    !!start &&
    typeof start.line === "number" &&
    typeof start.character === "number"
  );
}

function walkDocumentSymbol(
  node: Record<string, unknown>,
  depth: number,
  out: FlatSymbol[],
): void {
  const name = typeof node.name === "string" ? node.name : "";
  if (!name) return;
  const kind = typeof node.kind === "number" ? node.kind : 0;
  // Prefer selectionRange (symbol name) over full range
  const range = isRange(node.selectionRange)
    ? node.selectionRange
    : isRange(node.range)
      ? node.range
      : null;
  if (!range) return;

  out.push({
    name,
    kind,
    detail: typeof node.detail === "string" ? node.detail : undefined,
    line: range.start.line,
    character: range.start.character,
    depth,
  });

  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === "object") {
        walkDocumentSymbol(child as Record<string, unknown>, depth + 1, out);
      }
    }
  }
}

/**
 * Flatten DocumentSymbol[] or SymbolInformation[] into a list for Structure popup.
 */
export function flattenDocumentSymbols(raw: unknown): FlatSymbol[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];

  const out: FlatSymbol[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    // SymbolInformation: has location.uri / location.range
    if (obj.location && typeof obj.location === "object") {
      const loc = obj.location as Record<string, unknown>;
      if (isRange(loc.range) && typeof obj.name === "string") {
        out.push({
          name: obj.name,
          kind: typeof obj.kind === "number" ? obj.kind : 0,
          line: loc.range.start.line,
          character: loc.range.start.character,
          depth: 0,
          containerName:
            typeof obj.containerName === "string" ? obj.containerName : undefined,
        });
      }
      continue;
    }

    // DocumentSymbol tree
    walkDocumentSymbol(obj, 0, out);
  }
  return out;
}
