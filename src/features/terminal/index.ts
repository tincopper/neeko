export { default as TerminalView } from './components/TerminalView';
export {
  terminalCache,
  terminalRebuildCallbacks,
  terminalCacheKey,
  destroyTerminalCache,
  destroyTerminalCachesByPrefix,
  refreshTerminal,
  terminalWrapperRefs,
  executedAgentKeys,
} from './components/terminalCache';
export { createTerminalForProject } from './components/terminalFactory';
export {
  launchAgentInTerminal,
  switchAgentInTerminal,
  sendToTerminal,
  pasteToTerminal,
  pasteToTerminalSession,
  wrapBracketedPaste,
  BRACKETED_PASTE_START,
  BRACKETED_PASTE_END,
} from './components/terminalCommands';
export { worktreeKey } from './components/worktreeTerminalKey';
export {
  cleanupTerminalsForTab,
  cleanupTerminalsForTabKey,
  closeEditorTab,
  closeAllEditorTabs,
} from './components/terminalTabCleanup';

// Deprecated WSL terminal exports — kept for backward compatibility.
export { default as WSLTerminalView } from './components/WSLTerminalView';
export {
  wslCacheKey,
  destroyWslCache,
  destroyWslCachesByPrefix,
  getWslSessionId,
  getWslOpenProjectIds,
  launchAgentInWslTerminal,
  getAllWslOpenProjectIds,
  refreshWslTerminal,
  switchAgentInWslTerminal,
  wslWrapperRefs,
  wslTerminalCache,
} from './components/terminalCache';

// Deprecated Remote terminal exports.
export { default as RemoteTerminalView } from './components/RemoteTerminalView';
export {
  remoteCacheKey,
  launchAgentInRemoteTerminal,
  destroyRemoteCache,
  destroyRemoteCachesByPrefix,
  refreshRemoteTerminal,
  switchAgentInRemoteTerminal,
  remoteWrapperRefs,
  remoteTerminalCache,
} from './components/terminalCache';

// New unified exports
export { findSessionIdForProject } from './components/terminalCache';

export { default as SplitLayout, type SplitStateInfo } from './components/SplitLayout';
export { updateAllTerminalThemes } from './components/index';
export type { TerminalTab } from './types';
export { useTerminalTabs } from './hooks/useTerminalTabs';

export { useTerminalStrategy } from './strategies';
