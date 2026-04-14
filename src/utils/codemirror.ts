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
};

// Cache for loaded language extensions
const langCache = new Map<string, Extension>();

/**
 * Get the CodeMirror language extension for a file based on its extension
 */
export async function getLanguageExtension(filename: string): Promise<Extension | null> {
  const ext = getFileExtension(filename);

  if (langCache.has(ext)) {
    return langCache.get(ext)!;
  }

  const loader = LANG_MAP[ext];
  if (!loader) return null;

  try {
    const lang = await loader();
    langCache.set(ext, lang);
    return lang;
  } catch {
    return null;
  }
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
