import { invoke } from "@tauri-apps/api/core";
import type { FileChangedEvent, FileContent } from "../types";
import { useEditorStore } from "../store/editorStore";
import { useFileChangedEvent } from "./useFileChangedEvent";

/**
 * useFileTabRefresh — listens for file-changed events and refreshes open file tabs.
 * Uses the centralized useFileChangedEvent to share a single IPC subscription.
 */
export function useFileTabRefresh() {
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
              const content = await invoke<FileContent>("read_file_content", {
                projectId: project_id,
                filePath: tab.data.filePath,
                rootPath: undefined,
              });
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
