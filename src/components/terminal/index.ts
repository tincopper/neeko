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
export { worktreeKey } from "./worktreeTerminalKey";
export { default as WSLTerminalView } from "./WSLTerminalView";
export { wslCacheKey, destroyWslCache, destroyWslCachesByPrefix, getWslSessionId, getWslOpenProjectIds, launchAgentInWslTerminal, getAllWslOpenProjectIds, refreshWslTerminal } from "./wslTerminalCache";
export { default as RemoteTerminalView } from "./RemoteTerminalView";
export { remoteCacheKey, launchAgentInRemoteTerminal, destroyRemoteCache, destroyRemoteCachesByPrefix, refreshRemoteTerminal } from "./remoteTerminalCache";
export { default as SplitLayout } from "./SplitLayout";
export { default as PaneToolbar } from "./PaneToolbar";
export { switchAgentInWslTerminal, wslWrapperRefs } from "./wslTerminalCache";
export { switchAgentInRemoteTerminal, remoteWrapperRefs } from "./remoteTerminalCache";

import { buildTerminalTheme } from "../../utils/terminal";
import { terminalCache } from "./terminalCache";
import { wslTerminalCache } from "./wslTerminalCache";
import { remoteTerminalCache } from "./remoteTerminalCache";

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
