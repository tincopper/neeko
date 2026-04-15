import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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

// Cache for loaded language extensions
const langCache = new Map<string, Extension>();

/**
 * Get the CodeMirror language extension for a file based on its extension.
 * Falls back to properties mode for unknown text files.
 */
export async function getLanguageExtension(filename: string): Promise<Extension | null> {
  const ext = getFileExtension(filename);
  const baseName = filename.split(/[/\\]/).pop()?.toLowerCase() || "";

  // 1. Check extension-based cache
  if (langCache.has(ext) && ext) {
    return langCache.get(ext)!;
  }

  // 2. Check filename-based cache
  if (langCache.has(baseName)) {
    return langCache.get(baseName)!;
  }

  // 3. Try extension-based mapping
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

  // 4. Try filename-based mapping (Dockerfile, Makefile, etc.)
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

  // 5. Fallback: use properties mode for unknown files with extensions
  //    (gives basic key-value / comment highlighting)
  if (ext) {
    try {
      const { StreamLanguage } = await import("@codemirror/language");
      const { properties } = await import("@codemirror/legacy-modes/mode/properties");
      const fallback = StreamLanguage.define(properties);
      langCache.set(ext, fallback);
      return fallback;
    } catch {
      return null;
    }
  }

  return null;
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
 * Build CodeMirror EditorView theme that uses CSS variables for theming
 */
export function getCmFontStyle(fontFamily: string, fontSize: number): Extension {
  const ff = buildFontFamily(fontFamily);
  return EditorView.theme({
    "&": {
      fontSize: `${fontSize}px`,
      fontFamily: ff,
      backgroundColor: "var(--bg-primary)",
      color: "var(--text-primary)",
    },
    ".cm-content": {
      fontFamily: ff,
      caretColor: "var(--accent-blue)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent-blue)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "rgba(var(--accent-blue-rgb), 0.3)",
    },
    ".cm-gutters": {
      fontFamily: ff,
      backgroundColor: "var(--bg-secondary)",
      color: "var(--text-muted)",
      borderRight: "1px solid var(--border-color)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--bg-hover)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(var(--accent-blue-rgb), 0.05)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--bg-tertiary)",
      border: "1px solid var(--border-color)",
      color: "var(--text-secondary)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--bg-tertiary)",
      border: "1px solid var(--border-color)",
      color: "var(--text-primary)",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul > li[aria-selected]": {
        backgroundColor: "var(--bg-hover)",
        color: "var(--text-primary)",
      },
    },
    ".cm-searchMatch": {
      backgroundColor: "rgba(var(--accent-blue-rgb), 0.2)",
      outline: "1px solid rgba(var(--accent-blue-rgb), 0.4)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(var(--accent-blue-rgb), 0.4)",
    },
  });
}

/**
 * Check if a file is a markdown file
 */
export function isMarkdownFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ext === ".md" || ext === ".mdx";
}
