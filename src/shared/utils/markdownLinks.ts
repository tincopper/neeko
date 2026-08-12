/**
 * 将 markdown 内部相对链接解析为绝对路径。
 *
 * 处理 `./`、`../`、绝对路径、Windows 反斜杠与 `#hash` 锚点；
 * 返回空字符串表示"无可打开的文件"（纯锚点 / 非路径协议 / 空 href）。
 * 外链（http/https）不由本函数处理，调用方应先行拦截。
 */
export function resolveInternalHref(href: string, basePath?: string): string {
  if (!href) return '';
  const normalized = href.replace(/\\/g, '/');
  const pathOnly = normalized.split('#')[0] ?? '';
  if (!pathOnly) return '';
  if (/^[a-zA-Z]:/.test(pathOnly)) {
    return pathOnly;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(pathOnly)) {
    return '';
  }
  if (pathOnly.startsWith('/')) {
    return pathOnly;
  }
  const clean = pathOnly.replace(/^\.\//, '');
  if (!basePath) return clean;
  const base = basePath.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalizePath(`${base}/${clean}`);
}

/** 规范化正斜杠路径：折叠 `.`/`..` 段。 */
function normalizePath(path: string): string {
  const stack: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return `/${stack.join('/')}`;
}
