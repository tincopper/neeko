import { useEffect, useRef } from "react";
import { IS_WINDOWS } from "../utils/platform";
import { refreshTerminal, refreshWslTerminal, refreshRemoteTerminal, terminalCacheKey } from "../components/terminal";
import { useProjectStore } from "../store/projectStore";
import { useConnectionStore } from "../store/connectionStore";
import { useWorktreeStore } from "../store/worktreeStore";
import { useEditorStore } from "../store/editorStore";
import { buildWorktreeTabKey } from "../utils/tabKey";
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

      // Ctrl+Tab / Ctrl+Shift+Tab: 切换 Tab（硬编码，不走 registry）
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const direction = e.shiftKey ? -1 : 1;
        cycleTab(direction);
        return;
      }

      const snapshot = {
        ...useProjectStore.getState(),
        ...useConnectionStore.getState(),
        ...useWorktreeStore.getState(),
        ...useEditorStore.getState(),
      };

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

          case "prevTab":
          case "nextTab": {
            e.preventDefault();
            const direction = action.id === "nextTab" ? 1 : -1;
            cycleTab(direction);
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

function buildProjectList(snapshot: {
  projects: ReturnType<typeof useProjectStore.getState>['projects'];
  wslEntries: ReturnType<typeof useConnectionStore.getState>['wslEntries'];
  remoteEntries: ReturnType<typeof useConnectionStore.getState>['remoteEntries'];
}): AllItem[] {
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

function findCurrentIndex(snapshot: {
  activeProjectId: ReturnType<typeof useProjectStore.getState>['activeProjectId'];
  activeWslKey: ReturnType<typeof useConnectionStore.getState>['activeWslKey'];
  activeRemoteKey: ReturnType<typeof useConnectionStore.getState>['activeRemoteKey'];
}, items: AllItem[]): number {
  const curWslKey = snapshot.activeWslKey;
  const curRemoteKey = snapshot.activeRemoteKey;
  return items.findIndex((item) => {
    if (item.type === "local") return item.id === snapshot.activeProjectId;
    if (item.type === "wsl") return item.distro === curWslKey?.distro && item.project.id === curWslKey?.projectId;
    return item.host === curRemoteKey?.host && item.project.id === curRemoteKey?.projectId;
  });
}

function switchTo(snapshot: {
  selectProject: ReturnType<typeof useProjectStore.getState>['selectProject'];
  selectWslProject: ReturnType<typeof useConnectionStore.getState>['selectWslProject'];
  selectRemoteProject: ReturnType<typeof useConnectionStore.getState>['selectRemoteProject'];
}, item: AllItem) {
  if (item.type === "local") {
    snapshot.selectProject(item.id);
  } else if (item.type === "wsl") {
    snapshot.selectWslProject(item.distro, item.project);
  } else {
    snapshot.selectRemoteProject(item.host, item.project);
  }
}

function cycleTab(direction: 1 | -1) {
  const snapshot = {
    ...useProjectStore.getState(),
    ...useConnectionStore.getState(),
    ...useWorktreeStore.getState(),
    ...useEditorStore.getState(),
  };

  const currentProjectId =
    snapshot.activeProjectId ??
    snapshot.activeWslKey?.projectId ??
    snapshot.activeRemoteKey?.projectId ??
    null;
  if (!currentProjectId) return;

  const worktreePath =
    snapshot.activeWorktreePath ??
    snapshot.activeWslWorktreePath ??
    snapshot.activeRemoteWorktreePath ??
    null;

  const tabKey = worktreePath
    ? buildWorktreeTabKey(currentProjectId, worktreePath)
    : currentProjectId;

  const projectTabs = snapshot.tabs[tabKey];
  if (!projectTabs || projectTabs.tabs.length === 0) return;

  const { tabs, activeTabId } = projectTabs;
  const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
  if (currentIndex < 0) return;

  const targetIndex = (currentIndex + direction + tabs.length) % tabs.length;
  useEditorStore.getState().activateTab(tabKey, tabs[targetIndex].id);
}
