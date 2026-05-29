// Re-export stub — migrated to src/features/terminal/components
export { default as TerminalView } from "@/features/terminal/components/TerminalView";
export {
  terminalCache,
  terminalRebuildCallbacks,
  terminalCacheKey,
  destroyTerminalCache,
  destroyTerminalCachesByPrefix,
  refreshTerminal,
  terminalWrapperRefs,
  executedAgentKeys,
} from "@/features/terminal/components/terminalCache";
export { createTerminalForProject } from "@/features/terminal/components/terminalFactory";
export { launchAgentInTerminal, switchAgentInTerminal, sendToTerminal } from "@/features/terminal/components/terminalCommands";
export { worktreeKey } from "@/features/terminal/components/worktreeTerminalKey";
export { default as WSLTerminalView } from "@/features/terminal/components/WSLTerminalView";
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
} from "@/features/terminal/components/terminalCache";
export { default as RemoteTerminalView } from "@/features/terminal/components/RemoteTerminalView";
export {
  remoteCacheKey,
  launchAgentInRemoteTerminal,
  destroyRemoteCache,
  destroyRemoteCachesByPrefix,
  refreshRemoteTerminal,
  switchAgentInRemoteTerminal,
  remoteWrapperRefs,
  remoteTerminalCache,
} from "@/features/terminal/components/terminalCache";
export { default as SplitLayout } from "@/features/terminal/components/SplitLayout";
export { updateAllTerminalThemes } from "@/features/terminal/components/index";
