import { useEffect, useRef } from "react";
import { IS_WINDOWS } from "../utils/platform";
import { refreshTerminal, refreshWslTerminal, refreshRemoteTerminal, terminalCacheKey } from "../components/terminal";
import { useAppStore } from "../store/appStore";
import type { WSLProject, RemoteProject } from "../types";
import {
  resolveBindings,
  matchesBinding,
  SHORTCUT_ACTIONS,
} from "../utils/shortcutRegistry";

interface UseKeyboardShortcutsParams {
  updateWtPath: (path: string | null, branch: string) => void;
  setWslWorktreePath: (path: string | null) => void;
  setWslWtBranch: (branch: string) => void;
  setRemoteWorktreePath: (path: string | null) => void;
  setRemoteWtBranch: (branch: string) => void;
  activeTabId: string | null;
  onCloseTab: (tabId: string) => void;
  shortcuts: Record<string, string>;
  onToggleTerminal: () => void;
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
  onToggleTerminal,
}: UseKeyboardShortcutsParams) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = document.querySelector("[data-modal]");
      if (el) return;

      const snapshot = useAppStore.getState();

      const bindings = resolveBindings(shortcutsRef.current);

      for (const action of SHORTCUT_ACTIONS) {
        const binding = bindings[action.id];
        if (!binding) continue;

        const result = matchesBinding(e, binding);
        if (!result.matched) continue;

        switch (action.id) {
          case "cycleWorktree": {
            e.preventDefault();
            if (snapshot.isTerminalView) {
              const opened = snapshot.openedWorktrees ?? [];
              if (opened.length === 0) break;
              const cur = snapshot.activeWorktreePath;
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
            } else if (snapshot.activeWslKey) {
              const opened = snapshot.wslOpenedWt ?? [];
              if (opened.length === 0) break;
              const cur = snapshot.activeWslWorktreePath;
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
            } else if (snapshot.activeRemoteKey) {
              const opened = snapshot.remoteOpenedWt ?? [];
              if (opened.length === 0) break;
              const cur = snapshot.activeRemoteWorktreePath;
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
            const p = snapshot.activeProject;
            if (p) {
              e.preventDefault();
              snapshot.openIde({ id: p.id, selected_ide: p.selected_ide });
            }
            break;
          }

          case "refreshTerminal": {
            e.preventDefault();
            if (snapshot.activeProjectId && snapshot.isTerminalView) {
              const key = terminalCacheKey(snapshot.activeProjectId, activeTabIdRef.current);
              refreshTerminal(key);
            } else if (IS_WINDOWS && snapshot.activeWslKey) {
              const k = `wsl:${snapshot.activeWslKey.distro}:${snapshot.activeWslKey.projectId}`;
              refreshWslTerminal(k);
            } else if (snapshot.activeRemoteKey) {
              const k = `remote:${snapshot.activeRemoteKey.host}:${snapshot.activeRemoteKey.projectId}`;
              refreshRemoteTerminal(k);
            }
            break;
          }

          case "closeTab": {
            e.preventDefault();
            const tabId = activeTabIdRef.current;
            if (tabId) {
              onCloseTab(tabId);
            }
            break;
          }

          case "cycleProject": {
            e.preventDefault();
            const allItems = buildProjectList(snapshot);
            if (allItems.length === 0) break;
            const currentIndex = findCurrentIndex(snapshot, allItems);
            switchTo(snapshot, allItems[(currentIndex + 1) % allItems.length]);
            break;
          }

          case "switchProject": {
            if (result.digit !== undefined) {
              e.preventDefault();
              const allItems = buildProjectList(snapshot);
              const target = allItems[result.digit - 1];
              if (target) switchTo(snapshot, target);
            }
            break;
          }

          case "toggleTerminal": {
            e.preventDefault();
            onToggleTerminal();
            break;
          }
        }

        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [updateWtPath, setWslWorktreePath, setWslWtBranch, setRemoteWorktreePath, setRemoteWtBranch, onCloseTab, onToggleTerminal]);
}

type AllItem =
  | { type: "local"; id: string }
  | { type: "wsl"; distro: string; project: WSLProject }
  | { type: "remote"; host: string; project: RemoteProject };

function buildProjectList(snapshot: ReturnType<typeof useAppStore.getState>): AllItem[] {
  return [
    ...snapshot.projects.map((p) => ({ type: "local" as const, id: p.id })),
    ...(IS_WINDOWS ? (snapshot.wslEntries ?? []).flatMap((entry) =>
      entry.projects.map((proj) => ({ type: "wsl" as const, distro: entry.distro, project: proj }))
    ) : []),
    ...(snapshot.remoteEntries ?? []).flatMap((entry) =>
      entry.projects.map((proj) => ({ type: "remote" as const, host: entry.host, project: proj }))
    ),
  ];
}

function findCurrentIndex(snapshot: ReturnType<typeof useAppStore.getState>, items: AllItem[]): number {
  const curWslKey = snapshot.activeWslKey;
  const curRemoteKey = snapshot.activeRemoteKey;
  return items.findIndex((item) => {
    if (item.type === "local") return item.id === snapshot.activeProjectId;
    if (item.type === "wsl") return item.distro === curWslKey?.distro && item.project.id === curWslKey?.projectId;
    return item.host === curRemoteKey?.host && item.project.id === curRemoteKey?.projectId;
  });
}

function switchTo(snapshot: ReturnType<typeof useAppStore.getState>, item: AllItem) {
  if (item.type === "local") {
    snapshot.selectProject(item.id);
  } else if (item.type === "wsl") {
    snapshot.selectWslProject(item.distro, item.project);
  } else {
    snapshot.selectRemoteProject(item.host, item.project);
  }
}
