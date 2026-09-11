/**
 * JDT 类文件 uri 的跨 feature 纯函数面：判定、展示/标识路径、tab 文档 uri 推导。
 *
 * 身份文法不在本模块：全部组合 [`fileRef`](./fileRef.ts)（文件身份唯一所有权
 * 模块，jdt 正则只在那里）。本模块只叠加「展示/文档 uri」这类纯派生行为，
 * 被 lsp 与 editor 两个 feature 共用，故落在 `shared/utils/`。
 */

import { fileRefFromLspUri, tabIdentityOf } from './fileRef';

/**
 * `jdt://` 类文件 uri 判定（jdtls 对 JDK/依赖符号返回的虚拟类文件 uri，
 * 非文件路径；内容按需经 `java/classFileContents` 门控命令获取）。纯函数。
 */
export function isJdtUri(uri: string): boolean {
  return fileRefFromLspUri(uri)?.kind === 'jdt';
}

/**
 * `jdt://` 类文件 uri 的展示/标识路径（面包屑、tab id、语言高亮推导用）：
 * 取 `?` 查询串之前的类路径（`contents/<module>/<pkg path>/<Name>.class`），
 * 映射为 `jdt:/<module>/<pkg path>/<Name>.java`——以 `.java` 结尾保证
 * `getLanguageExtension` 命中 java 高亮；路径形态使面包屑显示
 * `jdt › java.base › java/io › PrintStream.java`。纯函数；解析失败回退原 uri。
 */
export function jdtDisplayPath(uri: string): string {
  const ref = fileRefFromLspUri(uri);
  return ref !== null && ref.kind === 'jdt' ? tabIdentityOf(ref) : uri;
}

/**
 * 推导 tab 的 LSP 文档 uri（请求时兜底，兼容 `virtualUri` 字段落地前的旧 tab）：
 * - `filePath` 本身是 `jdt://`（最早版本直接存原始 uri）→ 原样；
 * - `content.path` 是 `jdt://`（classContents 加载的只读 buffer 恒如此，含查询串）
 *   → 用它；
 * - 都不是 → `undefined`（调用方回落 `toFileUri(filePath)` 常规文档）。
 */
export function tabLspDocumentUri(tab: {
  filePath: string;
  content?: { path: string };
}): string | undefined {
  if (isJdtUri(tab.filePath)) return tab.filePath;
  const contentPath = tab.content?.path;
  if (contentPath && isJdtUri(contentPath)) return contentPath;
  return undefined;
}
