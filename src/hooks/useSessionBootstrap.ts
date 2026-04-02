import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { WSLEntrySession, RemoteEntrySession } from "../types";

export function useSessionBootstrap(deps: {
  loadAgents: () => Promise<void>;
  loadProjects: () => Promise<void>;
  setWslEntries: React.Dispatch<React.SetStateAction<WSLEntrySession[]>>;
  setRemoteEntries: React.Dispatch<React.SetStateAction<RemoteEntrySession[]>>;
  setSideTerminalWidth: (w: number) => void;
  worktreeStateRef: React.MutableRefObject<Record<string, string>>;
  restoreAuthFromEntries: (entries: RemoteEntrySession[]) => void;
}) {
  const [initialSidebarWidth, setInitialSidebarWidth] = useState<number>(280);

  useEffect(() => {
    deps.loadAgents();
    deps.loadProjects();

    invoke<any>("load_session").then((session: any) => {
      const wslE = session.wsl_entries ?? [];
      const remoteE = session.remote_entries ?? [];
      deps.setWslEntries(wslE);
      deps.setRemoteEntries(remoteE);
      if (session.sidebar_width) {
        setInitialSidebarWidth(session.sidebar_width);
      }
      if (session.side_terminal_width) {
        deps.setSideTerminalWidth(session.side_terminal_width);
      }
      const wtState = session.worktree_state;
      if (wtState && typeof wtState === "object") {
        deps.worktreeStateRef.current = wtState;
      }
      deps.restoreAuthFromEntries(remoteE);
    }).catch(console.error);

    const unlistenPromise = listen<string>("git-changed", (event) => {
      const projectId = event.payload;
      invoke("refresh_git_info", { projectId })
        .then(() => deps.loadProjects())
        .catch(() => deps.loadProjects());
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return { initialSidebarWidth };
}
