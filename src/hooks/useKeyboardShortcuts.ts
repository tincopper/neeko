import { useEffect } from "react";
import { IS_WINDOWS } from "../utils/platform";
import { refreshTerminal, refreshWslTerminal, refreshRemoteTerminal } from "../components/terminal";
import { useAppStore } from "../store/appStore";

interface UseKeyboardShortcutsParams {
  updateWtPath: (path: string | null, branch: string) => void;
  setWslWorktreePath: (path: string | null) => void;
  setWslWtBranch: (branch: string) => void;
  setRemoteWorktreePath: (path: string | null) => void;
  setRemoteWtBranch: (branch: string) => void;
  activeTabId: string | null;
  onCloseTab: (tabId: string) => void;
}

export function useKeyboardShortcuts({
  updateWtPath,
  setWslWorktreePath,
  setWslWtBranch,
  setRemoteWorktreePath,
  setRemoteWtBranch,
  activeTabId,
  onCloseTab,
}: UseKeyboardShortcutsParams) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const snapshot = useAppStore.getState();

      if (e.ctrlKey && !e.altKey && e.code === "KeyN") {
        e.preventDefault();
        if (snapshot.isTerminalView) {
          const opened = snapshot.openedWorktrees ?? [];
          if (opened.length === 0) return;
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
        }
        else if (snapshot.activeWslKey) {
          const opened = snapshot.wslOpenedWt ?? [];
          if (opened.length === 0) return;
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
        }
        else if (snapshot.activeRemoteKey) {
          const opened = snapshot.remoteOpenedWt ?? [];
          if (opened.length === 0) return;
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
        return;
      }

      if (e.ctrlKey && !e.altKey && e.code === "KeyO") {
        const p = snapshot.activeProject;
        if (p) {
          e.preventDefault();
          snapshot.openIde({ id: p.id, selected_ide: p.selected_ide });
        }
        return;
      }

      if (e.ctrlKey && !e.altKey && e.code === "KeyR") {
        e.preventDefault();
        if (snapshot.activeProjectId && snapshot.isTerminalView) {
          refreshTerminal(snapshot.activeProjectId);
        } else if (IS_WINDOWS && snapshot.activeWslKey) {
          const k = `wsl:${snapshot.activeWslKey.distro}:${snapshot.activeWslKey.projectId}`;
          refreshWslTerminal(k);
        } else if (snapshot.activeRemoteKey) {
          const k = `remote:${snapshot.activeRemoteKey.host}:${snapshot.activeRemoteKey.projectId}`;
          refreshRemoteTerminal(k);
        }
        return;
      }

      if (e.ctrlKey && !e.altKey && e.code === "KeyW") {
        e.preventDefault();
        if (activeTabId) {
          onCloseTab(activeTabId);
        }
        return;
      }

      if (!e.ctrlKey || e.altKey) return;

      const allItems = [
        ...snapshot.projects.map((p) => ({ type: "local" as const, id: p.id })),
        ...(IS_WINDOWS ? (snapshot.wslEntries ?? []).flatMap((entry) =>
          entry.projects.map((proj) => ({ type: "wsl" as const, distro: entry.distro, project: proj }))
        ) : []),
        ...(snapshot.remoteEntries ?? []).flatMap((entry) =>
          entry.projects.map((proj) => ({ type: "remote" as const, host: entry.host, project: proj }))
        ),
      ];

      const switchTo = (item: (typeof allItems)[number]) => {
        if (item.type === "local") {
          snapshot.selectProject(item.id);
        } else if (item.type === "wsl") {
          snapshot.selectWslProject(item.distro, item.project);
        } else {
          snapshot.selectRemoteProject(item.host, item.project);
        }
      };

      if (e.code === "KeyQ") {
        e.preventDefault();
        if (allItems.length === 0) return;
        const curWslKey = snapshot.activeWslKey;
        const curRemoteKey = snapshot.activeRemoteKey;
        const currentIndex = allItems.findIndex((item) => {
          if (item.type === "local") return item.id === snapshot.activeProjectId;
          if (item.type === "wsl") return item.distro === curWslKey?.distro && item.project.id === curWslKey?.projectId;
          return item.host === curRemoteKey?.host && item.project.id === curRemoteKey?.projectId;
        });
        switchTo(allItems[(currentIndex + 1) % allItems.length]);
        return;
      }

      const match = e.code.match(/^Digit([1-9])$/);
      if (match) {
        e.preventDefault();
        const target = allItems[parseInt(match[1]) - 1];
        if (target) switchTo(target);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [updateWtPath, setWslWorktreePath, setWslWtBranch, setRemoteWorktreePath, setRemoteWtBranch, activeTabId, onCloseTab]);
}
