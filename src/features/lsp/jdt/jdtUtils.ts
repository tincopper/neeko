/**
 * JDT feature 内部行为：类文件内容读取（`java/classFileContents` 门控命令）
 * 与虚拟文档生命周期消息识别（传输层拦截）。
 *
 * 纯判定/展示路径/tab 文档 uri 推导已下沉 `@/shared/utils/jdt`（被 lsp 与 editor
 * 两个 feature 共用）；身份文法仍归 `@/shared/utils/fileRef`（jdt 正则唯一处）。
 */
import { lspReadClassFileContents } from '../api/lspApi';

/**
 * 读取 jdtls 类文件内容（attached source 或反编译）。门控授权与
 * `lsp_read_preauthorized_file` 同型：后端只服务本会话最近 definition
 * 响应中出现过的 uri。返回 content 字符串；错误上抛，由调用方分类
 * （如 definitionTarget 的 read-failed）。
 */
export async function readClassFileContents(
  projectPath: string,
  languageId: string,
  uri: string,
): Promise<string> {
  const { content } = await lspReadClassFileContents(projectPath, languageId, uri);
  return content;
}

/**
 * 是否为虚拟文档（`jdt://` 类文件 uri）的 LSP 文档生命周期消息。
 * 纯函数：供 `TauriLspTransport.send` 拦截（对齐 vscode-java：content-provider
 * 文档不发 didOpen/didChange/didClose）与单测复用；JSON.parse 容错。
 */
export function isVirtualDocLifecycleMessage(message: string): boolean {
  if (!message.includes('"method":"textDocument/did')) return false;
  try {
    const parsed = JSON.parse(message) as { params?: { textDocument?: { uri?: string } } };
    return parsed.params?.textDocument?.uri?.startsWith('jdt://') ?? false;
  } catch {
    return false;
  }
}
