/**
 * Pure DOM builders for the CodeMirror 6 completion UI.
 *
 * These functions turn an LSP `CompletionItem` into the DOM nodes that render
 * in the autocomplete dropdown (left column = list item) and the info panel
 * (right column = master-detail). Kept free of CM6 imports so they stay unit-
 * testable in isolation.
 *
 * Design goals (per the IntelliSense audit):
 *   - List item: icon + name on the first line, module path on a second
 *     muted line — breathing room instead of a crammed single line.
 *   - Info panel: signature header + documentation body + parameter table +
 *     returns — full context without jumping to source.
 */

/** LSP CompletionItemKind → CM6 icon type mapping (mirrors @codemirror/lsp-client). */
const KIND_TO_TYPE: Record<number, string> = {
  1: 'text',
  2: 'method',
  3: 'function',
  4: 'class',
  5: 'property',
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'namespace',
  10: 'property',
  11: 'keyword',
  12: 'constant',
  13: 'constant',
  14: 'keyword',
  16: 'constant',
  20: 'constant',
  21: 'constant',
  22: 'class',
  25: 'type',
};

export interface ParsedParam {
  name: string;
  type: string;
  doc: string;
}

export interface ParsedSignature {
  params: ParsedParam[];
  returns: string;
}

/**
 * Parse an LSP detail string (e.g. `func(name string, id int) error`) into
 * structured params + returns. Handles Go-style (`name type`), Rust-style
 * (`name: type`), and arrow returns (`-> T` or trailing `T`).
 */
export function parseSignatureDetail(detail: string): ParsedSignature {
  if (!detail.trim()) return { params: [], returns: '' };

  let returns = '';
  let working = detail;

  // Arrow-style returns (Rust): `-> Result<()>` or `-> &str`
  const arrowMatch = working.match(/->\s*(.+)$/);
  if (arrowMatch) {
    returns = arrowMatch[1].trim();
    working = working.slice(0, arrowMatch.index).trim();
  } else {
    // Trailing return after closing paren: `func(...) error` or `func(...) (int, error)`.
    // Match the LAST `)` and everything after it as potential returns.
    const closeIdx = working.lastIndexOf(')');
    if (closeIdx !== -1 && closeIdx < working.length - 1) {
      const after = working.slice(closeIdx + 1).trim();
      // Strip optional outer parens: `(int, error)` → `int, error`
      const cleaned = after.replace(/^\((.+)\)$/, '$1').trim();
      if (cleaned && !cleaned.includes('(')) {
        returns = cleaned;
        working = working.slice(0, closeIdx + 1);
      }
    }
  }

  // Extract the parenthesized parameter list from the remaining working string.
  const openIdx = working.indexOf('(');
  const closeIdx = working.lastIndexOf(')');
  const params: ParsedParam[] = [];

  if (openIdx !== -1 && closeIdx > openIdx) {
    const inner = working.slice(openIdx + 1, closeIdx).trim();
    if (inner) {
      for (const raw of splitTopLevel(inner)) {
        params.push(parseSingleParam(raw));
      }
    }
  }

  return { params, returns };
}

/** Split a parameter string on top-level commas (keeps nested generics intact). */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(' || ch === '<' || ch === '[') depth++;
    else if (ch === ')' || ch === '>' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts.filter((p) => p.length > 0);
}

/** Parse a single `name type` or `name: type` parameter fragment. */
function parseSingleParam(raw: string): ParsedParam {
  const trimmed = raw.trim();
  if (!trimmed) return { name: '', type: '', doc: '' };

  // Rust-style: `name: type`
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx !== -1) {
    return {
      name: trimmed.slice(0, colonIdx).trim(),
      type: trimmed.slice(colonIdx + 1).trim(),
      doc: '',
    };
  }

  // Go-style: `name type` (first space separates name from type)
  // But handle variadic: `...args` or `args ...Type`
  const spaceMatch = trimmed.match(/^(\S+)\s+(\S.*)$/);
  if (spaceMatch) {
    return { name: spaceMatch[1], type: spaceMatch[2].trim(), doc: '' };
  }

  // Single token — treat as name only
  return { name: trimmed, type: '', doc: '' };
}

/** Escape `}` / `\` so a parameter name cannot break out of a snippet field. */
function escapeSnippetParam(name: string): string {
  return name.replace(/[\\}]/g, '\\$&');
}

/**
 * Extract the parameter list from a function signature label, e.g.
 * `foo(param1 string, param2 int) error` → `["param1 string", "param2 int"]`.
 * Returns `null` when the label carries no parenthesized parameter list.
 */
export function parseSignatureParams(label: string): string[] | null {
  const open = label.indexOf('(');
  if (open === -1) return null;

  let depth = 0;
  let close = -1;
  for (let i = open; i < label.length; i++) {
    const ch = label[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;

  const inner = label.slice(open + 1, close);
  if (inner.trim() === '') return [];

  return splitTopLevel(inner).filter((p) => p.length > 0);
}

/**
 * Extract the parameter *name* from a signature fragment.
 *   - `param1 string` / `param1: str` → `param1`
 *   - `...args ...int` → `args`
 * Returns `''` when no identifier is present.
 */
export function extractParamName(param: string): string {
  let name = param.trim();
  if (name.startsWith('...')) name = name.slice(3).trim();
  const m = name.match(/[A-Za-z_$][\w$]*/);
  return m ? m[0] : '';
}

/**
 * Build a CodeMirror snippet template for a function completion so accepting
 * it auto-fills parameters with tab stops (IDEA-style):
 *   - known params → `foo(${1:param1}, ${2:param2})`
 *   - no / unknown params → `foo(${1})` (cursor lands inside the parens)
 */
export function buildFunctionSnippet(funcName: string, label: string): string {
  const params = parseSignatureParams(label);
  if (params === null || params.length === 0) return `${funcName}(\${1})`;
  const placeholders = params.map(
    (p, i) => `\${${i + 1}:${escapeSnippetParam(extractParamName(p))}}`,
  );
  return `${funcName}(${placeholders.join(', ')})`;
}

/**
 * Build the per-list-item metadata: icon type, right-aligned detail, an
 * optional module-path node (injected via addToOptions), and a CSS class.
 */
export function buildListItem(
  completion: { label?: string; displayLabel?: string },
  item: {
    kind?: number | null;
    type?: string | null;
    detail?: string | null;
    insert_text?: string | null;
  },
): {
  type: string;
  detail: string;
  moduleNode: HTMLElement | null;
  optionClass: string;
} {
  // Prefer the type already mapped by `@codemirror/lsp-client` — the option
  // object it hands us carries `type: item.kind && kindToType[item.kind]`,
  // NOT the raw LSP `kind`. Resolving from `kind` alone would yield
  // `undefined` → fall back to `property`, rendering the same "v" icon for
  // every entry (functions and methods included). `kind` remains as a
  // fallback for kinds lsp-client's table doesn't cover (16/20/21/22/25).
  const type =
    item.type || (item.kind != null ? (KIND_TO_TYPE[item.kind] ?? 'property') : 'property');

  // Clean detail: strip leading "func(" prefix so it reads as a signature.
  let detail = item.detail ?? '';
  detail = detail.replace(/^func\(/, '(').trim();

  // Build a module-path node from the detail if it looks like a qualified path.
  // We use the completion label as a fallback hint for the module context.
  const moduleNode = buildModuleNode(detail, completion.label);

  return {
    type,
    detail,
    moduleNode,
    optionClass: 'cm-completion-item-enhanced',
  };
}

/**
 * If the detail contains a recognizable module path, render it as a muted
 * second line. Returns null when no useful module info is present.
 */
function buildModuleNode(detail: string, label?: string): HTMLElement | null {
  const module = extractModulePath(detail, label);
  if (!module) return null;

  const node = document.createElement('div');
  node.className = 'cm-lsp-completion-module';
  node.textContent = module;
  return node;
}

/**
 * Extract the module/path context for the muted second line.
 *
 * Priority:
 *   1. Rust arrow return path — `-> std::fs::Result<Vec<u8>>` → `std::fs`
 *   2. Go parenthesized package — `(github.com/.../dispatch.Type, error)`
 *      → `github.com/.../dispatch` (drops the trailing type segment)
 *   3. `::`-qualified label (Rust) — `std::fs::read` → `std::fs`
 *
 * NOTE: a plain `.`-prefixed label (`run.Testxxx`) is deliberately NOT used —
 * `run` is just a package shorthand, and rendering it as a "module" row adds
 * a confusing extra line above the symbol (`run` on its own line). Only paths
 * that clearly identify a module/file are surfaced.
 */
function extractModulePath(detail: string, label?: string): string | null {
  // Rust arrow return: the module path precedes the final `::Type` segment.
  const arrow = detail.match(/->\s*([A-Za-z_][\w]*::[\w:]+)/);
  if (arrow) return stripTrailingSegment(arrow[1], '::');

  // Go package in parens: `(github.com/.../dispatch.Type, error)`.
  const pkg = detail.match(/\(([a-z][\w/.-]*\.[A-Za-z_][\w]*)/);
  if (pkg) return stripTrailingSegment(pkg[1], '.');

  if (label?.includes('::')) {
    const parts = label.split('::');
    if (parts.length > 1) return parts.slice(0, -1).join('::');
  }

  return null;
}

/** Drop the last `sep`-separated segment (`std::fs::Result` → `std::fs`). */
function stripTrailingSegment(path: string, sep: '.' | '::'): string {
  const last = path.lastIndexOf(sep);
  return last > 0 ? path.slice(0, last) : path;
}

/**
 * Build a module-path node from a CM6 completion (for addToOptions injection).
 * Prefers the LSP item's source-file URI (`item.data.URI`, sent by gopls
 * et al.) so the second line shows where the symbol lives — the prototype's
 * `dispatch_test.go:42` style. Falls back to the detail/label heuristics.
 */
export function buildModuleNodeFromCompletion(completion: {
  label?: string;
  detail?: string;
  data?: { URI?: string };
}): HTMLElement | null {
  const uri = completion.data?.URI;
  if (uri) {
    const node = document.createElement('div');
    node.className = 'cm-lsp-completion-module';
    node.textContent = formatUriPath(uri);
    return node;
  }
  return buildModuleNode(completion.detail ?? '', completion.label);
}

/** `file:///home/dev/proj/event/dispatcher/dispatch_test.go` → relative-ish path. */
function formatUriPath(uri: string): string {
  const path = uri.replace(/^file:\/\//, '').replace(/^\/+/, '/');
  const segments = path.split('/').filter(Boolean);
  // Keep the last three segments so the module line stays short, matching
  // the prototype's `event/dispatcher/dispatch.go` style.
  return segments.slice(-3).join('/') || path;
}

/**
 * Build the signature header as colored spans: function name, parameter names,
 * parameter types, and return type - each in a distinct CSS class so the
 * signature reads like syntax-highlighted code, not a monochrome string.
 *
 * Falls back to plain text when the detail has no parseable params/returns.
 */
function buildSignatureSpans(funcName: string, parsed: ParsedSignature): Node {
  const frag = document.createDocumentFragment();

  const nameSpan = document.createElement('span');
  nameSpan.className = 'cm-lsp-info-fn-name';
  nameSpan.textContent = funcName;
  frag.appendChild(nameSpan);

  if (parsed.params.length > 0) {
    frag.appendChild(document.createTextNode('('));
    parsed.params.forEach((p, i) => {
      if (i > 0) frag.appendChild(document.createTextNode(', '));
      if (p.name) {
        const paramSpan = document.createElement('span');
        paramSpan.className = 'cm-lsp-info-param';
        paramSpan.textContent = p.name;
        frag.appendChild(paramSpan);
      }
      if (p.type) {
        if (p.name) frag.appendChild(document.createTextNode(' '));
        const typeSpan = document.createElement('span');
        typeSpan.className = 'cm-lsp-info-param-type';
        typeSpan.textContent = p.type;
        frag.appendChild(typeSpan);
      }
    });
    frag.appendChild(document.createTextNode(')'));
  }

  if (parsed.returns) {
    frag.appendChild(document.createTextNode(' '));
    const retSpan = document.createElement('span');
    retSpan.className = 'cm-lsp-info-return-type';
    retSpan.textContent = parsed.returns;
    frag.appendChild(retSpan);
  }

  return frag;
}

/**
 * Build the full info panel DOM (right column of the master-detail layout).
 * Sections appear conditionally: signature + docs always; params / returns
 * only when the data is available.
 */
export function buildInfoPanel(
  completion: { label?: string },
  item: { detail?: string | null; kind?: number | null },
  docHtml: string,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cm-lsp-completion-info';

  const funcName = completion.label ?? item.detail ?? 'unknown';
  const detail = item.detail ?? '';
  const parsed = parseSignatureDetail(detail);

  // 1. Signature header - colored spans when parseable, plain text fallback.
  const signature = document.createElement('div');
  signature.className = 'cm-lsp-info-signature';
  if (parsed.params.length > 0 || parsed.returns) {
    signature.appendChild(buildSignatureSpans(funcName, parsed));
  } else if (detail && detail.includes('(')) {
    // Looks like a signature but couldn't be fully parsed - show as-is.
    signature.textContent = `${funcName}${cleanSignatureDetail(detail)}`;
  } else {
    // Non-function (variable, constant, etc.) - just show the name.
    signature.textContent = funcName;
  }
  panel.appendChild(signature);

  // 2. Documentation body — rendered only when the server actually returned
  // documentation (empty docs would show as a blank block with stray margin).
  if (docHtml.trim()) {
    const docs = document.createElement('div');
    docs.className = 'cm-lsp-info-docs cm-lsp-documentation';
    docs.innerHTML = docHtml;
    panel.appendChild(docs);
  }

  // 3. Parameter table (with section title)
  if (parsed.params.length > 0) {
    const title = document.createElement('div');
    title.className = 'cm-lsp-info-section-title';
    title.textContent = 'Parameters';
    panel.appendChild(title);
    panel.appendChild(buildParamsTable(parsed.params));
  }

  // 4. Returns - structured label + type
  if (parsed.returns) {
    const returnsEl = document.createElement('div');
    returnsEl.className = 'cm-lsp-info-returns';

    const label = document.createElement('span');
    label.className = 'cm-lsp-info-returns-label';
    label.textContent = 'Returns';
    returnsEl.appendChild(label);

    const type = document.createElement('span');
    type.className = 'cm-lsp-info-returns-type';
    type.textContent = parsed.returns;
    returnsEl.appendChild(type);

    panel.appendChild(returnsEl);
  }

  // Note: no auto-generated call example (`fn(param1, param2)`) here — the
  // prototype (`prototype-autocomplete.html`) ends the panel at Returns, and
  // a fabricated call line reads as an extra, redundant row underneath it.

  return panel;
}

/** Build the parameter table element. */
function buildParamsTable(params: ParsedParam[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'cm-lsp-info-params';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const h of ['Parameter', 'Type', 'Description']) {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const p of params) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.className = 'cm-lsp-param-name';
    nameTd.textContent = p.name;
    tr.appendChild(nameTd);

    const typeTd = document.createElement('td');
    typeTd.className = 'cm-lsp-param-type';
    typeTd.textContent = p.type;
    tr.appendChild(typeTd);

    const docTd = document.createElement('td');
    docTd.className = 'cm-lsp-param-doc';
    docTd.textContent = p.doc;
    tr.appendChild(docTd);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}

/** Strip the leading `func(` from a Go detail so it can follow the func name. */
function cleanSignatureDetail(detail: string): string {
  return detail.replace(/^func\(/, '(').trim();
}
