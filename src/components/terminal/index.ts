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

import { invoke } from "@tauri-apps/api/core";
import { buildTerminalTheme } from "../../utils/terminal";
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

export function updateAllTerminalFontSizes(fontSize: number) {
   // 更新所有本地终端字号 + refresh（刷新渲染缓冲区以修复乱码）
   for (const cache of terminalCache.values()) {
      cache.term.options.fontSize = fontSize;
      cache.term.refresh(0, cache.term.rows - 1);
   }
   // 更新所有 WSL 终端字号 + refresh
   for (const cache of wslTerminalCache.values()) {
      cache.term.options.fontSize = fontSize;
      cache.term.refresh(0, cache.term.rows - 1);
   }
   // 更新所有远程终端字号 + refresh
   for (const cache of remoteTerminalCache.values()) {
      cache.term.options.fontSize = fontSize;
      cache.term.refresh(0, cache.term.rows - 1);
   }

   // 在下一帧 fit + resize PTY，确保终端尺寸与新字号对齐
   requestAnimationFrame(() => {
      for (const cache of terminalCache.values()) {
         try {
            cache.fitAddon.fit();
            if (cache.sessionId) {
               invoke("resize_terminal", {
                  sessionId: cache.sessionId,
                  cols: cache.term.cols,
                  rows: cache.term.rows,
               }).catch(() => {});
            }
         } catch { /* 终端可能已销毁 */ }
      }
      for (const cache of wslTerminalCache.values()) {
         try {
            cache.fitAddon.fit();
            if (cache.sessionId) {
               invoke("resize_terminal", {
                  sessionId: cache.sessionId,
                  cols: cache.term.cols,
                  rows: cache.term.rows,
               }).catch(() => {});
            }
         } catch { /* 终端可能已销毁 */ }
      }
      for (const cache of remoteTerminalCache.values()) {
         try {
            cache.fitAddon.fit();
            if (cache.sessionId) {
               invoke("resize_remote_terminal", {
                  sessionId: cache.sessionId,
                  cols: cache.term.cols,
                  rows: cache.term.rows,
               }).catch(() => {});
            }
         } catch { /* 终端可能已销毁 */ }
      }
   });
}
