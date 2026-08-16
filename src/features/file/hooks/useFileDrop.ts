/**
 * File/Directory drag-to-input: stores the dragged path in a module-level
 * variable during dragStart, then pastes it into the **currently active**
 * terminal tab or agent input when the drag ends.
 *
 * - Uses "dragend" (guaranteed to fire, no preventDefault needed).
 * - Sends to the active tab if it's a terminal (agent or plain).
 * - If focus is in a textarea / contenteditable (agent input), inserts there.
 * - Does NOT auto-submit (no \r) — path is pasted, user can edit.
 */

import { useEffect } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- file drop sends commands to terminal via terminal feature
import { sendToTerminal } from '@/features/terminal';
import { INSERT_TO_AGENT_INPUT_EVENT } from '@/shared/events';
import { useEditorStore } from '@/shared/store/editorStore';

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

      // Priority 1: if focus is in a textarea / contenteditable (agent input),
      // dispatch the insert event so the agent input receives the path.
      const activeEl = document.activeElement;
      if (activeEl && isTextInputElement(activeEl)) {
        window.dispatchEvent(
          new CustomEvent(INSERT_TO_AGENT_INPUT_EVENT, { detail: { text: path + ' ' } }),
        );
        return;
      }

      // Priority 2: find the currently active tab for this project
      const entry = useEditorStore.getState().tabs[projectId];
      if (!entry) return;

      const activeTab = entry.tabs.find((t) => t.id === entry.activeTabId);
      if (!activeTab || activeTab.data.kind !== 'terminal') return;

      sendToTerminal(projectId, path + ' ', activeTab.id);
    };

    document.addEventListener('dragend', handleDragEnd);
    return () => document.removeEventListener('dragend', handleDragEnd);
  }, []);
}

/** Whether the given element is a text input that can receive inserted text. */
function isTextInputElement(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type?.toLowerCase();
    return type === 'text' || type === 'search' || type === 'url' || type === '';
  }
  if (el.getAttribute('contenteditable') === 'true') return true;
  return false;
}
