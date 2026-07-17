import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import { createTheme } from "@uiw/codemirror-themes";
import { buildFontFamily } from "./terminal";

// Extension to file extension mapping (lazy loaded)
const LANG_MAP: Record<string, () => Promise<Extension>> = {
  ".ts": async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ typescript: true });
  },
  ".tsx": async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ jsx: true, typescript: true });
  },
  ".js": async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript();
  },
  ".jsx": async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ jsx: true });
  },
  ".mjs": async () => {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript();
  },
  ".rs": async () => {
    const { rust } = await import("@codemirror/lang-rust");
    return rust();
  },
  ".py": async () => {
    const { python } = await import("@codemirror/lang-python");
    return python();
  },
  ".json": async () => {
    const { json } = await import("@codemirror/lang-json");
    return json();
  },
  ".jsonc": async () => {
    const { json } = await import("@codemirror/lang-json");
    return json();
  },
  ".md": async () => {
    const { markdown } = await import("@codemirror/lang-markdown");
    return markdown();
  },
  ".mdx": async () => {
    const { markdown } = await import("@codemirror/lang-markdown");
    return markdown();
  },
  ".css": async () => {
    const { css } = await import("@codemirror/lang-css");
    return css();
  },
  ".scss": async () => {
    const { css } = await import("@codemirror/lang-css");
    return css();
  },
  ".less": async () => {
    const { css } = await import("@codemirror/lang-css");
    return css();
  },
  ".html": async () => {
    const { html } = await import("@codemirror/lang-html");
    return html();
  },
  ".htm": async () => {
    const { html } = await import("@codemirror/lang-html");
    return html();
  },
  ".vue": async () => {
    const { html } = await import("@codemirror/lang-html");
    return html();
  },
  ".svelte": async () => {
    const { html } = await import("@codemirror/lang-html");
    return html();
  },
  // Go language
  ".go": async () => {
    const { go } = await import("@codemirror/lang-go");
    return go();
  },
  // Java language
  ".java": async () => {
    const { java } = await import("@codemirror/lang-java");
    return java();
  },
  // Lua language (using legacy modes)
  ".lua": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { lua } = await import("@codemirror/legacy-modes/mode/lua");
    return StreamLanguage.define(lua);
  },
  // YAML language (using legacy modes)
  ".yaml": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { yaml } = await import("@codemirror/legacy-modes/mode/yaml");
    return StreamLanguage.define(yaml);
  },
  ".yml": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { yaml } = await import("@codemirror/legacy-modes/mode/yaml");
    return StreamLanguage.define(yaml);
  },
  // Shell scripts
  ".sh": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { shell } = await import("@codemirror/legacy-modes/mode/shell");
    return StreamLanguage.define(shell);
  },
  ".bash": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { shell } = await import("@codemirror/legacy-modes/mode/shell");
    return StreamLanguage.define(shell);
  },
  ".zsh": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { shell } = await import("@codemirror/legacy-modes/mode/shell");
    return StreamLanguage.define(shell);
  },
  // TOML
  ".toml": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { toml } = await import("@codemirror/legacy-modes/mode/toml");
    return StreamLanguage.define(toml);
  },
  // XML
  ".xml": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { xml } = await import("@codemirror/legacy-modes/mode/xml");
    return StreamLanguage.define(xml);
  },
  ".svg": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { xml } = await import("@codemirror/legacy-modes/mode/xml");
    return StreamLanguage.define(xml);
  },
  // SQL
  ".sql": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { standardSQL } = await import("@codemirror/legacy-modes/mode/sql");
    return StreamLanguage.define(standardSQL);
  },
  // Dockerfile
  ".dockerfile": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { dockerFile } = await import("@codemirror/legacy-modes/mode/dockerfile");
    return StreamLanguage.define(dockerFile);
  },
  // Ruby
  ".rb": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { ruby } = await import("@codemirror/legacy-modes/mode/ruby");
    return StreamLanguage.define(ruby);
  },
  // Perl
  ".pl": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { perl } = await import("@codemirror/legacy-modes/mode/perl");
    return StreamLanguage.define(perl);
  },
  // PowerShell
  ".ps1": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { powerShell } = await import("@codemirror/legacy-modes/mode/powershell");
    return StreamLanguage.define(powerShell);
  },
  // Swift
  ".swift": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { swift } = await import("@codemirror/legacy-modes/mode/swift");
    return StreamLanguage.define(swift);
  },
  // Properties / ini / env (use properties mode)
  ".properties": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { properties } = await import("@codemirror/legacy-modes/mode/properties");
    return StreamLanguage.define(properties);
  },
  ".ini": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { properties } = await import("@codemirror/legacy-modes/mode/properties");
    return StreamLanguage.define(properties);
  },
  ".env": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { properties } = await import("@codemirror/legacy-modes/mode/properties");
    return StreamLanguage.define(properties);
  },
  ".conf": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { properties } = await import("@codemirror/legacy-modes/mode/properties");
    return StreamLanguage.define(properties);
  },
  // Diff / patch
  ".diff": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { diff } = await import("@codemirror/legacy-modes/mode/diff");
    return StreamLanguage.define(diff);
  },
  ".patch": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { diff } = await import("@codemirror/legacy-modes/mode/diff");
    return StreamLanguage.define(diff);
  },
  // Protobuf
  ".proto": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { protobuf } = await import("@codemirror/legacy-modes/mode/protobuf");
    return StreamLanguage.define(protobuf);
  },
  // C#
  ".cs": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { csharp } = await import("@codemirror/legacy-modes/mode/clike");
    return StreamLanguage.define(csharp);
  },
  // C / C++
  ".c": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { c } = await import("@codemirror/legacy-modes/mode/clike");
    return StreamLanguage.define(c);
  },
  ".h": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { c } = await import("@codemirror/legacy-modes/mode/clike");
    return StreamLanguage.define(c);
  },
  ".cpp": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { cpp } = await import("@codemirror/legacy-modes/mode/clike");
    return StreamLanguage.define(cpp);
  },
  ".hpp": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { cpp } = await import("@codemirror/legacy-modes/mode/clike");
    return StreamLanguage.define(cpp);
  },
};

// Filename-based mapping (files without standard extensions)
const FILENAME_MAP: Record<string, () => Promise<Extension>> = {
  "dockerfile": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { dockerFile } = await import("@codemirror/legacy-modes/mode/dockerfile");
    return StreamLanguage.define(dockerFile);
  },
  "makefile": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { shell } = await import("@codemirror/legacy-modes/mode/shell");
    return StreamLanguage.define(shell);
  },
  ".gitignore": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { properties } = await import("@codemirror/legacy-modes/mode/properties");
    return StreamLanguage.define(properties);
  },
  ".editorconfig": async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { properties } = await import("@codemirror/legacy-modes/mode/properties");
    return StreamLanguage.define(properties);
  },
};

// Cache for loaded language extensions (sync hit path for tab switches)
const langCache = new Map<string, Extension>();
// In-flight loads so concurrent open/prefetch share one dynamic import
const langPending = new Map<string, Promise<Extension | null>>();

function languageCacheKey(filename: string): { key: string; ext: string; baseName: string } {
  const ext = getFileExtension(filename);
  const baseName = filename.split(/[/\\]/).pop()?.toLowerCase() || "";
  const key = ext || baseName;
  return { key, ext, baseName };
}

/**
 * Synchronous cache lookup — used so FileViewer can mount CodeMirror
 * with a language extension already applied (avoids double reconfigure).
 */
export function getCachedLanguageExtension(filename: string): Extension | null {
  const { ext, baseName } = languageCacheKey(filename);
  if (ext && langCache.has(ext)) return langCache.get(ext)!;
  if (baseName && langCache.has(baseName)) return langCache.get(baseName)!;
  return null;
}

/**
 * Prefetch language support for a file path without blocking the caller.
 * Fire this as soon as go-to-definition knows the target path.
 */
export function preloadLanguageExtension(filename: string): void {
  if (getCachedLanguageExtension(filename)) return;
  void getLanguageExtension(filename);
}

/**
 * Get the CodeMirror language extension for a file based on its extension.
 * Falls back to properties mode for unknown text files.
 */
export async function getLanguageExtension(filename: string): Promise<Extension | null> {
  const cached = getCachedLanguageExtension(filename);
  if (cached) return cached;

  const { key, ext, baseName } = languageCacheKey(filename);
  if (!key) return null;

  const pending = langPending.get(key);
  if (pending) return pending;

  const load = (async (): Promise<Extension | null> => {
    // 1. Try extension-based mapping
    const extLoader = LANG_MAP[ext];
    if (extLoader) {
      try {
        const lang = await extLoader();
        langCache.set(ext, lang);
        return lang;
      } catch {
        return null;
      }
    }

    // 2. Try filename-based mapping (Dockerfile, Makefile, etc.)
    const fnLoader = FILENAME_MAP[baseName];
    if (fnLoader) {
      try {
        const lang = await fnLoader();
        langCache.set(baseName, lang);
        return lang;
      } catch {
        return null;
      }
    }

    // 3. Fallback: properties mode for unknown files with extensions
    if (ext) {
      try {
        const { StreamLanguage } = await import("@codemirror/language");
        const { properties } = await import(
          "@codemirror/legacy-modes/mode/properties"
        );
        const fallback = StreamLanguage.define(properties);
        langCache.set(ext, fallback);
        return fallback;
      } catch {
        return null;
      }
    }

    return null;
  })().finally(() => {
    langPending.delete(key);
  });

  langPending.set(key, load);
  return load;
}

/**
 * Get the file extension (including the dot)
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Build a CodeMirror theme that reads all colors from CSS variables.
 * Creates a new theme object each call so CodeMirror reconfigures on prop change.
 */
export function createCmTheme(fontFamily: string, fontSize: number) {
  const ff = buildFontFamily(fontFamily);
  return createTheme({
    theme: "dark",
    settings: {
      fontSize: `${fontSize}px`,
      fontFamily: ff,
      background: "var(--bg-secondary)",
      foreground: "var(--text-primary)",
      caret: "var(--accent-blue)",
      selection: "rgba(var(--accent-blue-rgb), 0.3)",
      selectionMatch: "rgba(var(--accent-blue-rgb), 0.2)",
      lineHighlight: "rgba(var(--accent-blue-rgb), 0.05)",
      gutterBackground: "var(--bg-secondary)",
      gutterForeground: "var(--text-muted)",
      gutterActiveForeground: "var(--text-primary)",
    },
    styles: [
      { tag: t.keyword, color: "var(--cm-keyword)", fontWeight: "bold" },
      { tag: t.comment, color: "var(--cm-comment)", fontStyle: "italic" },
      { tag: t.string, color: "var(--cm-string)" },
      { tag: t.number, color: "var(--cm-number)" },
      { tag: t.operator, color: "var(--cm-operator)" },
      { tag: t.variableName, color: "var(--cm-variableName)" },
      { tag: t.typeName, color: "var(--cm-typeName)" },
      { tag: t.propertyName, color: "var(--cm-propertyName)" },
      { tag: t.function(t.variableName), color: "var(--cm-function)" },
      { tag: t.className, color: "var(--cm-className)" },
      { tag: t.definition(t.variableName), color: "var(--cm-definition)" },
      { tag: t.meta, color: "var(--cm-meta)" },
      { tag: t.tagName, color: "var(--cm-tag)" },
      { tag: t.atom, color: "var(--cm-atom)" },
      { tag: t.bool, color: "var(--cm-bool)" },
      { tag: t.punctuation, color: "var(--cm-punctuation)" },
      { tag: t.bracket, color: "var(--cm-bracket)" },
    ],
  });
}

/**
 * Check if a file is a markdown file
 */
export function isMarkdownFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ext === ".md" || ext === ".mdx";
}
