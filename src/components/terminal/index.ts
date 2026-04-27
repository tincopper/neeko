export { default as TerminalView } from "./TerminalView";
export {
  terminalCache,
  terminalRebuildCallbacks,
  terminalCacheKey,
  destroyTerminalCache,
  destroyTerminalCachesByPrefix,
  refreshTerminal,
  pendingPtyResize,
  setPendingPtyResize,
  terminalWrapperRefs,
  executedAgentKeys,
} from "./terminalCache";
export { createTerminalForProject } from "./terminalFactory";
export { launchAgentInTerminal, switchAgentInTerminal } from "./terminalCommands";
export { default as WorktreeTerminalView, worktreeKey } from "./WorktreeTerminalView";
export { default as WSLTerminalView, wslCacheKey, destroyWslCache, destroyWslCachesByPrefix, getWslSessionId, getWslOpenProjectIds, launchAgentInWslTerminal, getAllWslOpenProjectIds, refreshWslTerminal } from "./WSLTerminalView";
export { default as RemoteTerminalView, remoteCacheKey, launchAgentInRemoteTerminal, destroyRemoteCache, destroyRemoteCachesByPrefix, refreshRemoteTerminal } from "./RemoteTerminalView";
export { default as SplitLayout } from "./SplitLayout";
export { default as PaneToolbar } from "./PaneToolbar";
export { switchAgentInWslTerminal, wslWrapperRefs } from "./WSLTerminalView";
export { switchAgentInRemoteTerminal, remoteWrapperRefs } from "./RemoteTerminalView";

import { buildTerminalTheme } from "../../utils/terminal";
import { terminalCache } from "./terminalCache";
import { wslTerminalCache } from "./WSLTerminalView";
import { remoteTerminalCache } from "./RemoteTerminalView";

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
