/**
 * lsp 域 api 面共享 DTO（纯类型，无 invoke —— 不受 api/ 白名单调用约束）。
 *
 * 从 `lspOwnershipApi.ts` 拆出：`LspExtensionMapEntryDto` 是 extension→language
 * 映射的载荷类型，由 `lspGetExtensionMap` / `lspApplySettings` 消费，与「文档
 * 所有权命令」语义无关 —— 归入通用类型文件，避免 ownership 文件职责被打糊。
 */

/** Built-in + custom extension map 条目（后端 `lsp_get_extension_map` / `lsp_apply_settings` 载荷）。 */
export interface LspExtensionMapEntryDto {
  extension: string;
  languageId: string;
  serverName: string;
  isCustom: boolean;
  /** 插件声明的单请求超时（ms）；未声明时为 undefined。 */
  requestTimeoutMs?: number;
}
