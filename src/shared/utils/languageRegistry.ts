/**
 * 语言词汇表 —— 扩展名 / 文件名 → **规范语言 id** 的唯一事实源。
 *
 * 现状：三处各有一张 extension→ 目标的表（LSP languageId / CodeMirror loader /
 * highlight.js 语言名）。它们的**值**天然不同（不同目标），但**扩展名归属**与
 * **语言命名**必须一致，否则就是静默漂移（历史上 `LSP_PROGRESS_EVENT_PREFIX`
 * 式的错配）。本表统一后者：
 *
 * - 新增 / 改名一个扩展名 → 只改这里；
 * - 各目标的**扩展名覆盖范围**仍是各自的产物（决定"哪个子系统处理哪些文件"），
 *   但语言名一律取自本表，且由 `languageRegistry.test.ts` 锁定三张投影表
 *   不得出现本表未收录的扩展名。
 *
 * 规范语言名对齐 LSP language id 习惯（`typescriptreact` / `javascriptreact`）。
 */

/** 扩展名（**不带点**、小写）→ 规范语言 id。 */
export const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  // JS / TS 家族
  js: 'javascript',
  mjs: 'javascript',
  jsx: 'javascriptreact',
  ts: 'typescript',
  tsx: 'typescriptreact',
  // 系统级语言
  rs: 'rust',
  go: 'go',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  scala: 'scala',
  // 脚本
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
  pl: 'perl',
  ps1: 'powershell',
  ex: 'elixir',
  exs: 'elixir',
  r: 'r',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  // 标记 / 样式 / 数据 / 配置
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  vue: 'vue',
  svelte: 'svelte',
  css: 'css',
  scss: 'css',
  less: 'css',
  md: 'markdown',
  mdx: 'markdown',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'properties',
  properties: 'properties',
  conf: 'properties',
  sql: 'sql',
  proto: 'protobuf',
  dockerfile: 'dockerfile',
  diff: 'diff',
  patch: 'diff',
  txt: 'plaintext',
  lock: 'plaintext',
  env: 'plaintext',
  gitignore: 'plaintext',
};

/** 无标准扩展名的文件名（**小写**）→ 规范语言 id。 */
export const LANGUAGE_BY_FILENAME: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'plaintext',
  '.editorconfig': 'properties',
};

/** 取小写扩展名（**不含点**）；无扩展名或仅前导点返回 `''`。 */
export function extensionOf(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** 取小写文件名（含前导点，用于 `LANGUAGE_BY_FILENAME` 查表）。 */
export function baseNameOf(filePath: string): string {
  return (filePath.replace(/\\/g, '/').split('/').pop() ?? filePath).toLowerCase();
}

/** 解析文件的规范语言 id：扩展名优先，其次文件名；未识别返回 `null`。 */
export function languageForPath(filePath: string): string | null {
  const ext = extensionOf(filePath);
  if (ext) {
    const byExt = LANGUAGE_BY_EXTENSION[ext];
    if (byExt) return byExt;
  }
  return LANGUAGE_BY_FILENAME[baseNameOf(filePath)] ?? null;
}
