import { useEffect, useRef } from "react";
import { IS_WINDOWS } from "@/shared/utils/platform";
import { refreshTerminal, refreshWslTerminal, refreshRemoteTerminal, terminalCacheKey } from "@/features/terminal/components/terminalCache";
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "@/features/connection/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useEditorStore } from "@/app/editor/store";
import { buildWorktreeTabKey } from "@/shared/utils/tabKey";
import { resolveBindings, matchesBinding, SHORTCUT_ACTIONS } from "@/shared/utils/shortcutRegistry";
import type { UnifiedProjectItem } from "@/features/project/hooks/useUnifiedProjectList";

interface UseKeyboardShortcutsParams {
  updateWtPath: (path: string | null, branch: string) => void;
  setWslWorktreePath: (path: string | null) => void;
  setWslWtBranch: (branch: string) => void;
  setRemoteWorktreePath: (path: string | null) => void;
  setRemoteWtBranch: (branch: string) => void;
  activeTabId: string | null;
  onCloseTab: (tabId: string) => void;
  shortcuts: Record<string, string>;
  unifiedItems: UnifiedProjectItem[];
}

export function useKeyboardShortcuts({
  updateWtPath,
  setWslWorktreePath,
  setWslWtBranch,
  setRemoteWorktreePath,
  setRemoteWtBranch,
  activeTabId,
  onCloseTab,
  shortcuts,
  unifiedItems,
}: UseKeyboardShortcutsParams) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = document.querySelector("[data-modal]");
      if (el) return;

      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const direction = e.shiftKey ? -1 : 1;
        cycleTab(direction);
        return;
      }

      const bindings = resolveBindings(shortcutsRef.current);

      for (const action of SHORTCUT_ACTIONS) {
        const binding = bindings[action.id];
        if (!binding) continue;

        const result = matchesBinding(e, binding);
        if (!result.matched) continue;

        switch (action.id) {
          case "cycleWorktree": {
            e.preventDefault();
            const proj = useProjectStore.getState();
            const conn = useConnectionStore.getState();
            const wt = useWorktreeStore.getState();
            if (proj.isTerminalView) {
              const opened = wt.openedWorktrees ?? [];
              if (opened.length === 0) break;
              const cur = wt.activeWorktreePath;
              if (cur === null) {
                updateWtPath(opened[0].path, opened[0].branch);
              } else {
                const idx = opened.findIndex((w) => w.path === cur);
                if (idx === opened.length - 1) {
                  updateWtPath(null, "");
                } else {
                  updateWtPath(opened[idx + 1].path, opened[idx + 1].branch);
                }
              }
            } else if (conn.activeWslKey) {
              const opened = wt.wslOpenedWt ?? [];
              if (opened.length === 0) break;
              const cur = wt.activeWslWorktreePath;
              if (cur === null) {
                setWslWorktreePath(opened[0].path);
                setWslWtBranch(opened[0].branch);
              } else {
                const idx = opened.findIndex((w) => w.path === cur);
                if (idx === opened.length - 1) {
                  setWslWorktreePath(null);
                  setWslWtBranch("");
                } else {
                  setWslWorktreePath(opened[idx + 1].path);
                  setWslWtBranch(opened[idx + 1].branch);
                }
              }
            } else if (conn.activeRemoteKey) {
              const opened = wt.remoteOpenedWt ?? [];
              if (opened.length === 0) break;
              const cur = wt.activeRemoteWorktreePath;
              if (cur === null) {
                setRemoteWorktreePath(opened[0].path);
                setRemoteWtBranch(opened[0].branch);
              } else {
                const idx = opened.findIndex((w) => w.path === cur);
                if (idx === opened.length - 1) {
                  setRemoteWorktreePath(null);
                  setRemoteWtBranch("");
                } else {
                  setRemoteWorktreePath(opened[idx + 1].path);
                  setRemoteWtBranch(opened[idx + 1].branch);
                }
              }
            }
            break;
          }

          case "openIde": {
            const p = useProjectStore.getState().activeProject;
            if (p) {
              e.preventDefault();
              const { selectProject: _s, ...store } = useProjectStore.getState();
              store.openIde({ id: p.id, selected_ide: p.selected_ide });
            }
            break;
          }

          case "refreshTerminal": {
            e.preventDefault();
            const proj = useProjectStore.getState();
            const conn = useConnectionStore.getState();
            if (proj.activeProjectId && proj.isTerminalView) {
              const key = terminalCacheKey(proj.activeProjectId, activeTabIdRef.current);
              refreshTerminal(key);
            } else if (IS_WINDOWS && conn.activeWslKey) {
              const k = `wsl:${conn.activeWslKey.distro}:${conn.activeWslKey.projectId}`;
              refreshWslTerminal(k);
            } else if (conn.activeRemoteKey) {
              const k = `remote:${conn.activeRemoteKey.host}:${conn.activeRemoteKey.projectId}`;
              refreshRemoteTerminal(k);
            }
            break;
          }

          case "closeTab": {
            e.preventDefault();
            const tabId = activeTabIdRef.current;
            if (tabId) onCloseTab(tabId);
            break;
          }

          case "prevTab":
          case "nextTab": {
            e.preventDefault();
            const direction = action.id === "nextTab" ? 1 : -1;
            cycleTab(direction);
            break;
          }

          case "cycleProject":
          case "switchProject": {
            e.preventDefault();
            if (unifiedItems.length === 0) break;

            let targetIdx: number;
            if (action.id === "cycleProject") {
              const currentIdx = findCurrentIndex(unifiedItems);
              targetIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % unifiedItems.length;
            } else if (result.digit !== undefined && result.digit >= 1) {
              targetIdx = result.digit - 1;
              if (targetIdx >= unifiedItems.length) break;
            } else {
              break;
            }

            switchToItem(unifiedItems[targetIdx]);
            break;
          }
        }

        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [updateWtPath, setWslWorktreePath, setWslWtBranch, setRemoteWorktreePath, setRemoteWtBranch, onCloseTab, unifiedItems]);
}

/** Find current position in the unified project list */
function findCurrentIndex(items: UnifiedProjectItem[]): number {
  const proj = useProjectStore.getState();
  const conn = useConnectionStore.getState();
  return items.findIndex((item) => {
    if (item.kind === "local") return item.id === proj.activeProjectId;
    if (item.kind === "wsl") {
      return item.distro === conn.activeWslKey?.distro && item.id === conn.activeWslKey?.projectId;
    }
    return item.host === conn.activeRemoteKey?.host && item.id === conn.activeRemoteKey?.projectId;
  });
}

/** Dispatch selection to the correct store callback */
function switchToItem(item: UnifiedProjectItem) {
  if (item.kind === "local") {
    const store = useProjectStore.getState();
    store.selectProject?.(item.id);
  } else if (item.kind === "wsl" && item.distro) {
    const store = useConnectionStore.getState();
    store.selectWslProject?.(item.distro, { id: item.id, path: item.path, name: item.name } as any);
  } else if (item.kind === "remote" && item.host) {
    const store = useConnectionStore.getState();
    store.selectRemoteProject?.(item.host, { id: item.id, path: item.path, name: item.name } as any);
  }
}

function cycleTab(direction: 1 | -1) {
  const proj = useProjectStore.getState();
  const conn = useConnectionStore.getState();
  const wt = useWorktreeStore.getState();
  const editor = useEditorStore.getState();

  const currentProjectId =
    proj.activeProjectId ??
    conn.activeWslKey?.projectId ??
    conn.activeRemoteKey?.projectId ??
    null;
  if (!currentProjectId) return;

  const worktreePath =
    wt.activeWorktreePath ??
    wt.activeWslWorktreePath ??
    wt.activeRemoteWorktreePath ??
    null;

  const tabKey = worktreePath
    ? buildWorktreeTabKey(currentProjectId, worktreePath)
    : currentProjectId;

  const projectTabs = editor.tabs[tabKey];
  if (!projectTabs || projectTabs.tabs.length === 0) return;

  const { tabs, activeTabId: currentActive } = projectTabs;
  const currentIndex = tabs.findIndex((t) => t.id === currentActive);
  if (currentIndex < 0) return;

  const targetIndex = (currentIndex + direction + tabs.length) % tabs.length;
  useEditorStore.getState().activateTab(tabKey, tabs[targetIndex].id);
}
