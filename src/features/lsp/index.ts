/**
 * LSP feature public surface.
 * UI and other features should import from here (or api/hooks), not from deep internals.
 */

export {
  lspRequest,
  lspNotification,
  lspOpenDocument,
  lspChangeDocument,
  lspCloseDocument,
  lspListSessions,
  lspRestartSession,
  lspStopSession,
  lspDetectProjectProfile,
  lspCheckServerInstalled,
  lspGetExtensionMap,
  lspGetExtensionConflicts,
} from './api/lspApi';
export { loadDefinitionTargetContent, showNavigationFailure } from './api/definitionTarget';
export type { DefinitionTargetContent } from './api/definitionTarget';
export { acquireLspPlugin, releaseLspClient } from './hooks/lspClientManager';
export { useCmdHeld } from './hooks/useCmdHeld';
export { useLspDefinition } from './hooks/useLspDefinition';
export { useLspLinkHighlightExtension, clearLinkHighlight } from './hooks/useLspLinkHighlight';
export { resolveLspPositionFromOffset } from './position';
export { resolveLspLanguageId, setCustomLspExtensionMap } from './languageMap';
export { fromFileUri, getLspLanguageId, toFileUri } from './languageMap';
export type { LspLocation, LspDiagnostic, ProjectLanguageProfile, LspSessionInfo } from './types';
