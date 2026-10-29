import hljs from 'highlight.js/lib/core';

const LANGUAGE_MAP: Record<string, () => Promise<unknown>> = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  python: () => import('highlight.js/lib/languages/python'),
  rust: () => import('highlight.js/lib/languages/rust'),
  java: () => import('highlight.js/lib/languages/java'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  go: () => import('highlight.js/lib/languages/go'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  php: () => import('highlight.js/lib/languages/php'),
  swift: () => import('highlight.js/lib/languages/swift'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  scala: () => import('highlight.js/lib/languages/scala'),
  css: () => import('highlight.js/lib/languages/css'),
  xml: () => import('highlight.js/lib/languages/xml'),
  json: () => import('highlight.js/lib/languages/json'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  sql: () => import('highlight.js/lib/languages/sql'),
  shell: () => import('highlight.js/lib/languages/shell'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  diff: () => import('highlight.js/lib/languages/diff'),
  plaintext: () => import('highlight.js/lib/languages/plaintext'),
};

type LanguageFn = (hljsApi: import('highlight.js').HLJSApi) => import('highlight.js').Language;

const registeredLangs = new Set<string>();

// 提前注册 plaintext（默认 fallback 语言），避免首次渲染时抛出未注册异常
void import('highlight.js/lib/languages/plaintext').then((mod) => {
  hljs.registerLanguage('plaintext', (mod as { default: LanguageFn }).default);
  registeredLangs.add('plaintext');
});

const EXT_TO_LANG: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.pyw': 'python',
  '.rs': 'rust',
  '.java': 'java',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.go': 'go',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.html': 'xml',
  '.htm': 'xml',
  '.xml': 'xml',
  '.svg': 'xml',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.dockerfile': 'dockerfile',
  Dockerfile: 'dockerfile',
  '.diff': 'diff',
  '.patch': 'diff',
  '.toml': 'plaintext',
  '.lock': 'plaintext',
  '.txt': 'plaintext',
  '.gitignore': 'plaintext',
  '.env': 'plaintext',
};

/** 覆盖的扩展名 / 文件名键 —— 供覆盖度护栏测试使用（词表见 `@/shared/utils/languageRegistry`）。 */
export const HIGHLIGHT_KEYS: readonly string[] = Object.keys(EXT_TO_LANG);

export async function ensureLanguageRegistered(lang: string): Promise<void> {
  if (registeredLangs.has(lang)) {
    return;
  }
  const loader = LANGUAGE_MAP[lang];
  if (!loader) {
    return;
  }

  const mod = await loader();
  hljs.registerLanguage(lang, (mod as { default: LanguageFn }).default);
  registeredLangs.add(lang);
}

export function detectLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('dockerfile')) {
    return 'dockerfile';
  }
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx === -1) {
    return 'plaintext';
  }
  const ext = lower.slice(dotIdx);
  return EXT_TO_LANG[ext] || 'plaintext';
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 单行语法高亮：语言未注册 / 高亮抛错时降级为纯转义文本（宁可无色，不可白屏）。
 *
 * 唯一出口 —— 不要拆成「同名转发 + 内部实现」两层：词级差分（`renderWordDiffHtml`）删除后，
 * 分片高亮与整行高亮已无区别，保留两个名字只会让「该用哪个」变成新的漂移点。
 */
export function renderHighlightedHtml(text: string, language: string): string {
  if (!language || !hljs.getLanguage(language)) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}
