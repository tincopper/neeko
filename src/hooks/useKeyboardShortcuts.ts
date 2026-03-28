import { useEffect, RefObject } from "react";
import { WSLEntrySession, WSLProject, RemoteEntrySession, RemoteProject } from "../types";
import { IS_WINDOWS } from "../utils/platform";
import { refreshTerminal, refreshSideTerminal, refreshWslTerminal, refreshRemoteTerminal } from "../components/terminal";

type ActiveWslKey = { distro: string; projectId: string } | null;
type ActiveRemoteKey = { host: string; projectId: string } | null;

type SwitchItem =
  | { type: "local"; id: string }
  | { type: "wsl"; distro: string; project: WSLProject }
  | { type: "remote"; host: string; project: RemoteProject };

interface UseKeyboardShortcutsParams {
  projects: { id: string }[];
  activeProjectId: string | null;
  sideTerminalOpenRef: RefObject<boolean>;
  setSideTerminalOpen: (open: boolean) => void;
  wslEntriesRef: RefObject<WSLEntrySession[]>;
  activeWslKeyRef: RefObject<ActiveWslKey>;
  selectWslProjectRef: RefObject<(distro: string, project: WSLProject) => void>;
  remoteEntriesRef: RefObject<RemoteEntrySession[]>;
  activeRemoteKeyRef: RefObject<ActiveRemoteKey>;
  selectRemoteProjectRef: RefObject<(host: string, project: RemoteProject) => void>;
  selectProjectRef: RefObject<(id: string) => void>;
  wslSideOpenRef: RefObject<Set<string>>;
  remoteSideOpenRef: RefObject<Set<string>>;
  setWslSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  setRemoteSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  activeWorktreePathRef: RefObject<string | null>;
  openedWorktreesRef: RefObject<{ path: string; branch: string }[]>;
  updateWtPath: (path: string | null, branch: string) => void;
  isTerminalViewRef: RefObject<boolean>;
  activeProjectRef: RefObject<{ id: string; selected_ide: string | null } | null>;
  handleOpenIde: (project: { id: string; selected_ide: string | null }) => void;
}

export function useKeyboardShortcuts({
  projects,
  activeProjectId,
  sideTerminalOpenRef,
  setSideTerminalOpen,
  wslEntriesRef,
  activeWslKeyRef,
  selectWslProjectRef,
  remoteEntriesRef,
  activeRemoteKeyRef,
  selectRemoteProjectRef,
  selectProjectRef,
  wslSideOpenRef,
  remoteSideOpenRef,
  setWslSideTerminalOpen,
  setRemoteSideTerminalOpen,
  activeWorktreePathRef,
  openedWorktreesRef,
  updateWtPath,
  isTerminalViewRef,
  activeProjectRef,
  handleOpenIde,
}: UseKeyboardShortcutsParams) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.code === "KeyT") {
        e.preventDefault();
        if (isTerminalViewRef.current) {
          setSideTerminalOpen(true);
        } else if (IS_WINDOWS && activeWslKeyRef.current) {
          const pid = activeWslKeyRef.current.projectId;
          setWslSideTerminalOpen(prev => new Set(prev).add(pid));
        } else if (activeRemoteKeyRef.current) {
          const pid = activeRemoteKeyRef.current.projectId;
          setRemoteSideTerminalOpen(prev => new Set(prev).add(pid));
        }
        return;
      }

      if (e.ctrlKey && !e.altKey && e.code === "KeyN") {
        const opened = openedWorktreesRef.current ?? [];
        if (opened.length === 0) return;
        e.preventDefault();
        const cur = activeWorktreePathRef.current;
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
        return;
      }

      if (e.ctrlKey && !e.altKey && e.code === "KeyW") {
        if (sideTerminalOpenRef.current) {
          e.preventDefault();
          setSideTerminalOpen(false);
        } else if (IS_WINDOWS && activeWslKeyRef.current) {
          const pid = activeWslKeyRef.current.projectId;
          if ((wslSideOpenRef.current ?? new Set()).has(pid)) {
            e.preventDefault();
            setWslSideTerminalOpen(prev => { const n = new Set(prev); n.delete(pid); return n; });
          }
        } else if (activeRemoteKeyRef.current) {
          const pid = activeRemoteKeyRef.current.projectId;
          if ((remoteSideOpenRef.current ?? new Set()).has(pid)) {
            e.preventDefault();
            setRemoteSideTerminalOpen(prev => { const n = new Set(prev); n.delete(pid); return n; });
          }
        }
        return;
      }

      if (e.ctrlKey && !e.altKey && e.code === "KeyO") {
        const p = activeProjectRef.current;
        if (p) {
          e.preventDefault();
          handleOpenIde(p);
        }
        return;
      }

      if (e.ctrlKey && !e.altKey && e.code === "KeyR") {
        e.preventDefault();
        if (sideTerminalOpenRef.current && activeProjectId) {
          refreshSideTerminal(activeProjectId);
        } else if (activeProjectId && isTerminalViewRef.current) {
          refreshTerminal(activeProjectId);
        } else if (IS_WINDOWS && activeWslKeyRef.current) {
          const k = `wsl:${activeWslKeyRef.current.distro}:${activeWslKeyRef.current.projectId}`;
          refreshWslTerminal(k);
        } else if (activeRemoteKeyRef.current) {
          const k = `remote:${activeRemoteKeyRef.current.host}:${activeRemoteKeyRef.current.projectId}`;
          refreshRemoteTerminal(k);
        }
        return;
      }

      if (!e.ctrlKey || e.altKey) return;

      const allItems: SwitchItem[] = [
        ...projects.map((p) => ({ type: "local" as const, id: p.id })),
        ...(IS_WINDOWS ? (wslEntriesRef.current ?? []).flatMap((entry) =>
          entry.projects.map((proj) => ({ type: "wsl" as const, distro: entry.distro, project: proj }))
        ) : []),
        ...(remoteEntriesRef.current ?? []).flatMap((entry) =>
          entry.projects.map((proj) => ({ type: "remote" as const, host: entry.host, project: proj }))
        ),
      ];

      const switchTo = (item: SwitchItem) => {
        if (item.type === "local") {
          selectProjectRef.current?.(item.id);
        } else if (item.type === "wsl") {
          selectWslProjectRef.current?.(item.distro, item.project);
        } else {
          selectRemoteProjectRef.current?.(item.host, item.project);
        }
      };

      if (e.code === "KeyQ") {
        e.preventDefault();
        if (allItems.length === 0) return;
        const curWslKey = activeWslKeyRef.current;
        const curRemoteKey = activeRemoteKeyRef.current;
        const currentIndex = allItems.findIndex((item) => {
          if (item.type === "local") return item.id === activeProjectId;
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
  }, [projects, activeProjectId]);
}
