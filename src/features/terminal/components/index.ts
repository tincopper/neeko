export { default as TerminalView } from './TerminalView';
export {
  terminalAddress,
  terminalAddressPrefix,
  terminalAddressPrefixOfTab,
  terminalKeyLabel,
  decodeTerminalKey,
} from './terminalAddress';
export {
  resolveTerminalEntry,
  resolveTerminalEntryOfTab,
  destroyTerminalsForProject,
  destroyTerminalsForSession,
  destroyTerminalsForTab,
  refreshTerminalForSession,
  refreshTerminalEntry,
} from './terminalCache';
export {
  sendToTerminal,
  pasteToTerminalSession,
  wrapBracketedPaste,
  BRACKETED_PASTE_START,
  BRACKETED_PASTE_END,
} from './terminalCommands';
export { switchAgentInTerminal } from './terminalAgentSwitch';
export {
  cleanupTerminalsForTab,
  cleanupTerminalsForTabKey,
  closeEditorTab,
  closeAllEditorTabs,
} from './terminalTabCleanup';
export {
  foregroundTerminalTab,
  foregroundAgentCliTab,
  foregroundAgentChatTabs,
  insertToTerminalTarget,
  insertToSessionTerminal,
  type ForegroundTarget,
  type InsertToSessionTerminalResult,
} from './terminalRouting';

export { default as SplitLayout } from './SplitLayout';

import { buildTerminalTheme } from '@/shared/utils/terminal';

import { terminalCache, wslTerminalCache, remoteTerminalCache } from './terminalCache';

export function updateAllTerminalThemes() {
  const theme = buildTerminalTheme();
  for (const cache of terminalCache.values()) {
    cache.term.options.theme = theme;
  }
  for (const cache of wslTerminalCache.values()) {
    cache.term.options.theme = theme;
  }
  for (const cache of remoteTerminalCache.values()) {
    cache.term.options.theme = theme;
  }
}
