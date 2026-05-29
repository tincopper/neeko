export { default as TerminalView } from "./TerminalView";
export {
  terminalCache,
  terminalRebuildCallbacks,
  terminalCacheKey,
  destroyTerminalCache,
  destroyTerminalCachesByPrefix,
  refreshTerminal,
  terminalWrapperRefs,
  executedAgentKeys,
} from "./terminalCache";
export { createTerminalForProject } from "./terminalFactory";
export { launchAgentInTerminal, switchAgentInTerminal, sendToTerminal } from "./terminalCommands";
export { worktreeKey } from "./worktreeTerminalKey";
export { default as WSLTerminalView } from "./WSLTerminalView";
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
} from "./terminalCache";
export { default as RemoteTerminalView } from "./RemoteTerminalView";
export {
  remoteCacheKey,
  launchAgentInRemoteTerminal,
  destroyRemoteCache,
  destroyRemoteCachesByPrefix,
  refreshRemoteTerminal,
  switchAgentInRemoteTerminal,
  remoteWrapperRefs,
  remoteTerminalCache,
} from "./terminalCache";
export { default as SplitLayout } from "./SplitLayout";

import { buildTerminalTheme } from "../../../utils/terminal";
import {
  terminalCache,
  wslTerminalCache,
  remoteTerminalCache,
} from "./terminalCache";

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
