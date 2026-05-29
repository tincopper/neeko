const ICON_BASE = "/icons/";

export function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const name = filename.toLowerCase();

  if (name === "cargo.toml") return "toml";
  if (name === "cargo.lock" || name === "package-lock.json" || name === "pnpm-lock.yaml" || name === "yarn.lock") return "lock";
  if (name === "package.json") return "json";
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "docker";
  if (name === ".gitignore" || name === ".gitattributes" || name === ".gitmodules") return "git";
  if (name === ".eslintrc" || name.startsWith(".eslintrc") || name === "eslint.config.js" || name === "eslint.config.ts") return "eslint";
  if (name === ".env" || name.startsWith(".env.")) return "config";
  if (name === "tsconfig.json" || name.startsWith("tsconfig.")) return "config";
  if (name === "vite.config.ts" || name === "vite.config.js") return "config";
  if (name === "tailwind.config.ts" || name === "tailwind.config.js") return "config";
  if (name === "readme.md" || name === "readme") return "markdown";
  if (name === "changelog.md" || name === "changelog") return "changelog";
  if (name === "makefile" || name === "cmake") return "config";

  switch (ext) {
    case "rs": return "rust";
    case "ts": return "typescript";
    case "tsx": return "react-typescript";
    case "js": case "mjs": case "cjs": return "javascript";
    case "jsx": return "react";
    case "svelte": return "svelte";
    case "vue": return "vue";
    case "astro": return "astro";
    case "html": case "htm": return "html";
    case "css": return "css";
    case "scss": case "sass": case "less": return "sass";
    case "json": case "jsonc": return "json";
    case "toml": return "toml";
    case "yaml": case "yml": return "yaml";
    case "xml": return "xml";
    case "csv": return "csv";
    case "md": case "mdx": return "markdown";
    case "py": return "python";
    case "go": return "go";
    case "java": return "java";
    case "kt": case "kts": return "kotlin";
    case "cs": return "cs";
    case "cpp": case "cc": case "cxx": return "cpp";
    case "hpp": case "hxx": return "cpp-header";
    case "c": return "c";
    case "h": return "c-header";
    case "swift": return "swift";
    case "rb": return "ruby";
    case "php": return "php";
    case "lua": return "lua";
    case "sh": case "bash": case "zsh": case "fish": return "config";
    case "ps1": return "powershell";
    case "bat": case "cmd": return "powershell";
    case "png": case "jpg": case "jpeg": case "gif": case "webp": case "ico": case "svg": case "bmp": return "image";
    case "ttf": case "woff": case "woff2": case "otf": return "font";
    case "mp3": case "wav": case "ogg": case "flac": return "audio";
    case "lock": return "lock";
    case "db": case "sqlite": case "sql": return "database";
    case "wasm": case "exe": case "dll": case "so": return "binary";
    default: return "_file";
  }
}

export function fileIconSrc(filename: string): string {
  return `${ICON_BASE}${getFileIcon(filename)}.svg`;
}
