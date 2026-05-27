import { invoke } from "@tauri-apps/api/core";
import type { FileChangedEvent, FileContent } from "../types";
import { useEditorStore } from "../store/editorStore";
import { useFileChangedEvent } from "./useFileChangedEvent";

interface FileRefreshCommands {
  readFileContent(path: string): Promise<FileContent>;
}

/**
 * useFileTabRefresh — listens for file-changed events and refreshes open file tabs.
 * Accepts optional commands for WSL/Remote file reading (from useActiveProject).
 * Falls back to direct invoke("read_file_content") for local when commands is null.
 */
export function useFileTabRefresh(commands?: FileRefreshCommands | null) {
  useFileChangedEvent(
    async (event: FileChangedEvent) => {
      const { project_id, paths } = event;
      if (!paths.length) return;

      const state = useEditorStore.getState();
      for (const [tabKey, projectTabs] of Object.entries(state.tabs)) {
        for (const tab of projectTabs.tabs) {
          if (tab.data.kind !== "file") continue;

          const normalizedTabPath = tab.data.filePath.replace(/\\/g, "/");
          if (!paths.includes(normalizedTabPath)) continue;

          if (tab.data.isDirty) {
            useEditorStore.getState().updateTab(tabKey, tab.id, {
              kind: "file",
              externallyModified: true,
            });
          } else {
            try {
              let content: FileContent;
              if (commands) {
                content = await commands.readFileContent(tab.data.filePath);
              } else {
                content = await invoke<FileContent>("read_file_content", {
                  projectId: project_id,
                  filePath: tab.data.filePath,
                  rootPath: undefined,
                });
              }
              useEditorStore.getState().updateTab(tabKey, tab.id, {
                kind: "file",
                content,
                externallyModified: false,
              });
            } catch (e) {
              console.warn("[useFileTabRefresh] Failed to refresh tab:", tab.data.filePath, e);
            }
          }
        }
      }
    },
  );
}
