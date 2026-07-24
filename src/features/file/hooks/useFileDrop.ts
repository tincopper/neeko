/**
 * File drag-to-terminal: stores the dragged file path in a module-level
 * variable during dragStart, then pastes it into the **currently active**
 * terminal tab when the drag ends.
 *
 * - Uses "dragend" (guaranteed to fire, no preventDefault needed).
 * - Sends to the active tab if it's a terminal (agent or plain).
 * - Does NOT auto-submit (no \r) — path is pasted, user can edit.
 */

import { useEffect } from "react";
import { useEditorStore } from "@/shared/store";
import { sendToTerminal } from "@/features/terminal/components/terminalCommands";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

interface DragPayload {
  path: string;
  projectId: string;
}

let pendingDrag: DragPayload | null = null;

export function setDragFile(path: string, projectId: string): void {
  pendingDrag = { path, projectId };
  console.log(`[drag] ${path}`);
}

// ---------------------------------------------------------------------------
// Hook — mount once at the top of the component tree (ProjectWorkspace)
// ---------------------------------------------------------------------------

export function useFileDrop(): void {
  useEffect(() => {
    const handleDragEnd = () => {
      if (!pendingDrag) return;
      const { path, projectId } = pendingDrag;
      pendingDrag = null;

      // Find the currently active tab for this project
      const entry = useEditorStore.getState().tabs[projectId];
      if (!entry) {
        console.log(`[dragend] no tabs for project "${projectId}"`);
        return;
      }

      const activeTab = entry.tabs.find((t) => t.id === entry.activeTabId);
      if (!activeTab || activeTab.data.kind !== "terminal") {
        console.log(`[dragend] active tab is not a terminal (kind=${activeTab?.data.kind})`);
        return;
      }

      sendToTerminal(projectId, path + " ", activeTab.id);
      console.log(`[dragend] → terminal: "${path}"`);
    };

    document.addEventListener("dragend", handleDragEnd);
    return () => document.removeEventListener("dragend", handleDragEnd);
  }, []);
}
