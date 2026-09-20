/**
 * LSP feature public surface（门面）。
 *
 * 按 Import/Export Firewall 规则 4，门面**只导出公开组件与公开 hooks**。
 * 函数式 API / 工具函数一律不经门面：
 * - 跨 feature 直导 `@/features/lsp/api/*`（store / types / api 为白名单面）；
 * - 纯协议工具（LSP position 换算等）在 `@/shared/utils/lspPosition`。
 */

export { acquireLspPlugin, releaseLspClient } from './hooks/lspClientManager';
export { lspDiagnosticsProjection } from './hooks/lspDiagnosticsProjection';
export { withJdtLinkHandler } from './hooks/lspHoverExtension';
// 编辑器内 quickfix（hover 提示 / 键位 / gutter 灯泡）：由 editor 域的装配处调用
export { lspQuickFix } from './hooks/lspQuickFix';
export { fromFileUri, getLspLanguageId } from './api/languageMap';
export { useCmdHeld } from './hooks/useCmdHeld';
export { useLspDefinition } from './hooks/useLspDefinition';
export { useLspLinkHighlightExtension, clearLinkHighlight } from './hooks/useLspLinkHighlight';
export { default as ProblemsPanel } from './components/ProblemsPanel';

export type { DefinitionTargetContent } from './api/definitionTarget';
export type { LspLocation, LspDiagnostic, ProjectLanguageProfile, LspSessionInfo } from './types';
