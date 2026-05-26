import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { FileChangedEvent, FileContent } from "../types";
import { useEditorStore } from "../store/editorStore";

/**
 * useFileTabRefresh
 *
 * 监听后端 `file-changed` 事件，对已打开的 file tab 执行刷新逻辑：
 * - isDirty === false：静默重新读取文件内容，更新 tab
 * - isDirty === true ：标记 externallyModified = true，由 FileViewer 弹 Modal 提示用户
 *
 * 只在 App 根组件挂载一次即可（通过 useAppContainer 调用）。
 */
export function useFileTabRefresh() {
  useEffect(() => {
    const unlistenPromise = listen<FileChangedEvent>("file-changed", async (event) => {
      const { project_id, paths } = event.payload;
      if (!paths.length) return;

      const state = useEditorStore.getState();

      // 遍历所有 tabKey 下的 tabs，找出 projectId 匹配 + filePath 命中的 file tab
      for (const [tabKey, projectTabs] of Object.entries(state.tabs)) {
        for (const tab of projectTabs.tabs) {
          if (tab.data.kind !== "file") continue;

          // 路径匹配：后端路径使用 `/` 分隔符，tab 中 filePath 可能混用 `\`，统一转为 `/`
          const normalizedTabPath = tab.data.filePath.replace(/\\/g, "/");
          if (!paths.includes(normalizedTabPath)) continue;

          if (tab.data.isDirty) {
            // 有未保存修改：标记 externallyModified，由 UI 弹 Modal
            useEditorStore.getState().updateTab(tabKey, tab.id, {
              kind: "file",
              externallyModified: true,
            });
          } else {
            // 无未保存修改：静默刷新
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
              // 文件可能已被删除，静默忽略
              console.warn("[useFileTabRefresh] Failed to refresh tab:", tab.data.filePath, e);
            }
          }
        }
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
