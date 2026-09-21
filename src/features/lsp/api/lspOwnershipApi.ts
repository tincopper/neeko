import { invoke } from '@tauri-apps/api/core';

/**
 * LSP 编辑器文档所有权命令（从 `lspApi.ts` 拆出 —— 行数红线 <300 台账）。
 *
 * api/ 白名单面不变：仍是 lsp 域的 api 面，调用方（`documentOwnership`）从本文件直导。
 */

/**
 * 声明编辑器视图持有该文档：后端在持有期间**不再代开**（代开只能读磁盘文本，
 * 会与编辑器未保存缓冲区错位）。
 */
export function lspClaimDocument(
  projectPath: string,
  languageId: string,
  uri: string,
): Promise<void> {
  return invoke<void>('lsp_claim_document', { projectPath, languageId, uri });
}

/** 释放编辑器持有（最后一个视图卸载时）。 */
export function lspReleaseDocument(
  projectPath: string,
  languageId: string,
  uri: string,
): Promise<void> {
  return invoke<void>('lsp_release_document', { projectPath, languageId, uri });
}
