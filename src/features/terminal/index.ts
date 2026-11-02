export { default as TerminalView } from './components/TerminalView';
export {
  terminalAddress,
  terminalAddressPrefix,
  terminalAddressPrefixOfTab,
  terminalKeyLabel,
  decodeTerminalKey,
} from './components/terminalAddress';
export {
  resolveTerminalEntry,
  destroyTerminalsForProject,
  destroyTerminalsForSession,
  destroyTerminalsForTab,
  refreshTerminalForSession,
  refreshTerminalEntry,
} from './components/terminalCache';
export {
  sendToTerminal,
  pasteToTerminalSession,
  wrapBracketedPaste,
  BRACKETED_PASTE_START,
  BRACKETED_PASTE_END,
} from './components/terminalCommands';
export { switchAgentInTerminal } from './components/terminalAgentSwitch';
export {
  cleanupTerminalsForTab,
  cleanupTerminalsForTabKey,
  closeEditorTab,
  closeAllEditorTabs,
} from './components/terminalTabCleanup';
export {
  foregroundTerminalTab,
  foregroundAgentCliTab,
  foregroundAgentChatTabs,
  insertToTerminalTarget,
  insertToSessionTerminal,
  type ForegroundTarget,
  type InsertToSessionTerminalResult,
} from './components/terminalRouting';

export { default as SplitLayout, type SplitStateInfo } from './components/SplitLayout';
export { updateAllTerminalThemes } from './components/index';
export type { TerminalTab } from './types';
export { useTerminalTabs } from './hooks/useTerminalTabs';
export { createTaskTerminal, type TaskTerminalOptions } from './api/taskTerminal';

export { useTerminalStrategy } from './strategies';
