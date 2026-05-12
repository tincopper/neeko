import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SessionStore, WSLEntrySession, RemoteEntrySession, Project } from "../types";
import { useAppStore } from "../store/appStore";

export function useSessionBootstrap(deps: {
   loadProjects: () => Promise<void>;
   setWslEntries: React.Dispatch<React.SetStateAction<WSLEntrySession[]>>;
   setRemoteEntries: React.Dispatch<React.SetStateAction<RemoteEntrySession[]>>;
   restoreWorktreeState: (worktreeState: Record<string, string>) => void;
   restoreAuthFromEntries: (entries: RemoteEntrySession[]) => void;
}) {
   const [initialSidebarWidth, setInitialSidebarWidth] = useState<number>(280);
   const [initializing, setInitializing] = useState(true);

   useEffect(() => {
      deps.loadProjects().then(async () => {
         try {
            const projects = await invoke<Project[]>("list_projects");
            for (const p of projects) {
               if (!p.git_info) {
                  invoke("refresh_git_info", { projectId: p.id }).catch(() => { });
               }
            }
         } catch { }
      });

      invoke<SessionStore>("load_session").then((session) => {
         const wslE = session.wsl_entries ?? [];
         const remoteE = session.remote_entries ?? [];
         deps.setWslEntries(wslE);
         deps.setRemoteEntries(remoteE);
         if (session.sidebar_width) {
            setInitialSidebarWidth(session.sidebar_width);
         }
         const wtState = session.worktree_state;
         if (wtState && typeof wtState === "object") {
            deps.restoreWorktreeState(wtState);
         }
         deps.restoreAuthFromEntries(remoteE);
         setInitializing(false);
      }).catch(console.error);

      const unlistenPromise = listen<string>("git-changed", (event) => {
         const projectId = event.payload;
         invoke("refresh_git_info", { projectId })
            .then(() => invoke<Project>("get_project", { projectId }))
            .then((updatedProject) => {
               useAppStore.setState((state) => {
                  const nextProjects = state.projects.map((p) =>
                     p.id === projectId ? updatedProject : p
                  );
                  const nextActiveProject = state.activeProjectId === projectId
                     ? updatedProject
                     : state.activeProject;
                  return {
                     projects: nextProjects,
                     activeProject: nextActiveProject,
                  };
               });
            })
            .catch((e) => console.error("[SessionBootstrap] git-changed update failed:", e));
      });

      return () => {
         unlistenPromise.then((unlisten) => unlisten());
      };
   }, []);

   return { initialSidebarWidth, initializing };
}
