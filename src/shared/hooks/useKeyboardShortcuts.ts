import { useEffect, useRef } from "react";
import { refreshTerminal, terminalCacheKey } from "@/features/terminal/components/terminalCache";
import { useProjectStore } from "@/features/project/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useEditorStore } from '@/shared/store';
import { useDockStore } from '@/shared/store/dockStore';
import { buildWorktreeTabKey } from "@/shared/utils/tabKey";
import { useNavHistoryStore } from "@/features/editor/navigationHistoryStore";
import {
  resolveBindings,
  matchesBinding,
  SHORTCUT_ACTIONS,
  getShortcutAction,
} from "@/shared/utils/shortcutRegistry";
import type { ProjectListItem } from "@/features/project/hooks/useProjectList";

interface UseKeyboardShortcutsParams {
  updateWtPath: (path: string | null, branch: string) => void;
  activeTabId: string | null;
  onCloseTab: (tabId: string) => void;
  shortcuts: Record<string, string>;
  unifiedItems: ProjectListItem[];
}

/** Global (non-editor-focused) actions handled here. Editor-scoped keys live in CodeMirror. */
const GLOBAL_ACTION_IDS = new Set([
  "cycleWorktree",
  "openIde",
  "refreshTerminal",
  "closeTab",
  "prevTab",
  "nextTab",
  "switchTabNext",
  "switchTabPrev",
  "cycleProject",
  "switchProject",
  "toggleDockProjects",
  "toggleDockSkills",
  "navigateBack",
  "navigateForward",
]);

export function useKeyboardShortcuts({
  updateWtPath,
  activeTabId,
  onCloseTab,
  shortcuts,
  unifiedItems,
}: UseKeyboardShortcutsParams) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.querySelector("[data-modal]") ||
        document.querySelector("[data-settings-view]")
      ) {
        return;
      }

      const bindings = resolveBindings(shortcutsRef.current);
      const inEditable = isEditableKeyboardTarget(e.target);

      for (const action of SHORTCUT_ACTIONS) {
        if (!GLOBAL_ACTION_IDS.has(action.id)) continue;

        const binding = bindings[action.id];
        if (!binding) continue;

        const result = matchesBinding(e, binding);
        if (!result.matched) continue;

        const def = getShortcutAction(action.id);
        if (inEditable && !def?.allowInEditable) {
          continue;
        }

        switch (action.id) {
          case "cycleWorktree": {
            e.preventDefault();
            const proj = useProjectStore.getState();
            const wt = useWorktreeStore.getState();
            if (!proj.activeProjectId) break;
            const opened = wt.openedWorktrees ?? [];
            if (opened.length === 0) break;
            const cur = wt.activeWorktreePath;
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
            break;
          }

          case "openIde": {
            const p = useProjectStore.getState().activeProject;
            if (p) {
              e.preventDefault();
              const store = useProjectStore.getState();
              store.openIde({ id: p.id, selected_ide: p.selected_ide });
            }
            break;
          }

          case "refreshTerminal": {
            e.preventDefault();
            const proj = useProjectStore.getState();
            if (proj.activeProjectId && proj.isTerminalView) {
              const key = terminalCacheKey(proj.activeProjectId, activeTabIdRef.current);
              refreshTerminal(key);
            }
            break;
          }

          case "closeTab": {
            e.preventDefault();
            const tabId = activeTabIdRef.current;
            if (tabId) onCloseTab(tabId);
            break;
          }

          case "prevTab":
          case "switchTabPrev": {
            e.preventDefault();
            cycleTab(-1);
            break;
          }

          case "nextTab":
          case "switchTabNext": {
            e.preventDefault();
            cycleTab(1);
            break;
          }

          case "toggleDockProjects": {
            e.preventDefault();
            useDockStore.getState().togglePanel("projects");
            break;
          }

          case "toggleDockSkills": {
            e.preventDefault();
            useDockStore.getState().togglePanel("skills");
            break;
          }

          case "navigateBack": {
            e.preventDefault();
            void useNavHistoryStore.getState().goBack();
            break;
          }

          case "navigateForward": {
            e.preventDefault();
            void useNavHistoryStore.getState().goForward();
            break;
          }

          case "cycleProject":
          case "switchProject": {
            e.preventDefault();
            if (unifiedItems.length === 0) break;

            let targetIdx: number;
            if (action.id === "cycleProject") {
              const currentIdx = findCurrentIndex(unifiedItems);
              targetIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % unifiedItems.length;
            } else if (result.digit !== undefined && result.digit >= 1) {
              targetIdx = result.digit - 1;
              if (targetIdx >= unifiedItems.length) break;
            } else {
              break;
            }

            switchToItem(unifiedItems[targetIdx]);
            break;
          }
        }

        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [updateWtPath, onCloseTab, unifiedItems]);
}

/** True when focus is in an element that should receive normal typing / caret keys. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  if (target.closest("input, textarea, select, [contenteditable=true], [role='textbox']")) {
    return true;
  }
  // CodeMirror is an editor, but app-level tab/workspace shortcuts must still
  // work while coding. Editor-scoped keys (save, F12) are handled by CM keymap.
  return false;
}

function findCurrentIndex(items: ProjectListItem[]): number {
  const proj = useProjectStore.getState();
  return items.findIndex((item) => item.id === proj.activeProjectId);
}

function switchToItem(item: ProjectListItem) {
  const store = useProjectStore.getState();
  store.selectProject?.(item.id);
}

function cycleTab(direction: 1 | -1) {
  const proj = useProjectStore.getState();
  const wt = useWorktreeStore.getState();
  const editor = useEditorStore.getState();

  const currentProjectId = proj.activeProjectId ?? null;
  if (!currentProjectId) return;

  const worktreePath = wt.activeWorktreePath ?? null;

  const tabKey = worktreePath
    ? buildWorktreeTabKey(currentProjectId, worktreePath)
    : currentProjectId;

  const projectTabs = editor.tabs[tabKey];
  if (!projectTabs || projectTabs.tabs.length === 0) return;

  const layout = editor.editorLayout[tabKey];
  const activeGroupId = layout?.activeGroupId ?? "left";
  const groupTabIds = layout?.groups[activeGroupId]?.tabIds;
  const orderedIds =
    groupTabIds && groupTabIds.length > 0
      ? groupTabIds
      : projectTabs.tabs.map((t) => t.id);

  const currentActive = projectTabs.activeTabId;
  if (!currentActive) return;
  const currentIndex = orderedIds.indexOf(currentActive);
  if (currentIndex < 0) return;

  const targetIndex = (currentIndex + direction + orderedIds.length) % orderedIds.length;
  useEditorStore.getState().activateTab(tabKey, orderedIds[targetIndex]);
}
