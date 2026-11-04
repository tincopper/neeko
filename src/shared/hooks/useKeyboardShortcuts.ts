import { useEffect, useRef } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- keyboard shortcuts reference project list types
import { useActionPaletteStore } from '@/features/action-menu/store/actionPaletteStore';
// eslint-disable-next-line import/no-restricted-paths -- keyboard shortcuts open Library at the skills kind
import { openLibraryAt } from '@/features/library/store/libraryNavigation';
// eslint-disable-next-line import/no-restricted-paths -- keyboard shortcuts open Library at the skills kind
import { useLibraryStore } from '@/features/library/store/libraryStore';
// eslint-disable-next-line import/no-restricted-paths -- keyboard shortcuts reference project list types
import type { ProjectListItem } from '@/features/project/hooks/useProjectList';
// eslint-disable-next-line import/no-restricted-paths -- keyboard shortcuts reference quick open store
import { useQuickOpenStore } from '@/features/quick-open/store/quickOpenStore';
// eslint-disable-next-line import/no-restricted-paths -- keyboard shortcuts need MRU tab cycle
import { useTabCycleStore } from '@/features/quick-open/store/tabCycleStore';
// eslint-disable-next-line import/no-restricted-paths -- keyboard shortcuts need terminal cache for refresh
import { refreshTerminalForSession } from '@/features/terminal/components/terminalCache';
// 门面（@/features/terminal）会形成 import/no-cycle：index → SplitLayout → @/shared/hooks。
// 与上一行同一口径直导（既有先例），前台仲裁只有一处实现（决议 R1/Q2）。
// eslint-disable-next-line import/no-restricted-paths -- needs the single foreground arbitration
import { foregroundTerminalTab } from '@/features/terminal/components/terminalRouting';
// eslint-disable-next-line import/no-restricted-paths
import { panelView, appViewKey } from '@/shared/dock';
import {
  cycleTab,
  resolveActiveTabKey,
  splitActiveTabRight,
  unsplitActiveEditor,
} from '@/shared/hooks/shortcutTabCommands';
import { useAppViewStore } from '@/shared/store/appViewStore';
// eslint-disable-next-line import/no-restricted-paths
import { useDockStore } from '@/shared/store/dockStore';
import { activeTabIdOf } from '@/shared/store/editorStore';
import { useNavHistoryStore } from '@/shared/store/navigationHistoryStore';
import { useProjectStore } from '@/shared/store/projectStore';
import {
  activeWorkspaceSession,
  selectWorkspaceStateOf,
  useWorkspaceStore,
} from '@/shared/store/workspaceStore';
import {
  resolveBindings,
  matchesBinding,
  SHORTCUT_ACTIONS,
  getShortcutAction,
} from '@/shared/utils/shortcutRegistry';

interface UseKeyboardShortcutsParams {
  updateWtPath: (path: string | null, branch: string) => void;
  onCloseTab: (tabId: string) => void;
  shortcuts: Record<string, string>;
  unifiedItems: ProjectListItem[];
}

/** Global (non-editor-focused) actions handled here. Editor-scoped keys live in CodeMirror. */
const GLOBAL_ACTION_IDS = new Set([
  'cycleWorktree',
  'openIde',
  'refreshTerminal',
  'closeTab',
  'prevTab',
  'nextTab',
  'switchTabNext',
  'switchTabPrev',
  'cycleProject',
  'switchProject',
  'toggleDockProjects',
  'toggleDockSkills',
  'toggleDockLibrary',
  'toggleDockSearch',
  'navigateBack',
  'navigateForward',
  'gotoFile',
  'recentFiles',
  'splitRight',
  'unsplitEditor',
  'commandPalette',
]);

export function useKeyboardShortcuts({
  updateWtPath,
  onCloseTab,
  shortcuts,
  unifiedItems,
}: UseKeyboardShortcutsParams) {
  const shortcutsRef = useRef(shortcuts);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.querySelector('[data-modal]') ||
        document.querySelector('[data-settings-view]')
      ) {
        return;
      }

      const bindings = resolveBindings(shortcutsRef.current);
      const inEditable = isEditableKeyboardTarget(e.target);
      // Any open palette (Goto File / Recent Files / Symbol Nav) owns the keyboard,
      // including Ctrl+Tab — no tab cycling underneath it.
      const quickOpenOpen = !!document.querySelector('[data-quick-open]');

      for (const action of SHORTCUT_ACTIONS) {
        if (!GLOBAL_ACTION_IDS.has(action.id)) continue;

        if (quickOpenOpen) {
          continue;
        }

        const binding = bindings[action.id];
        if (!binding) continue;

        const result = matchesBinding(e, binding);
        if (!result.matched) continue;

        const def = getShortcutAction(action.id);
        if (inEditable && !def?.allowInEditable) {
          continue;
        }

        switch (action.id) {
          case 'cycleWorktree': {
            e.preventDefault();
            const projectId = useProjectStore.getState().activeProjectId;
            if (!projectId) break;
            // 单一表示：只读该项目的工作树状态（旧 openedWorktrees/activeWorktreePath 镜像已删）
            const { activePath: cur, opened } = selectWorkspaceStateOf(
              useWorkspaceStore.getState(),
              projectId,
            );
            if (opened.length === 0) break;
            if (cur === null) {
              updateWtPath(opened[0].path, opened[0].branch);
            } else {
              const idx = opened.findIndex((w) => w.path === cur);
              if (idx === opened.length - 1) {
                updateWtPath(null, '');
              } else {
                updateWtPath(opened[idx + 1].path, opened[idx + 1].branch);
              }
            }
            break;
          }

          case 'openIde': {
            const p = useProjectStore.getState().activeProject;
            if (p) {
              e.preventDefault();
              const store = useProjectStore.getState();
              store.openIde({ id: p.id, selected_ide: p.selected_ide });
            }
            break;
          }

          case 'refreshTerminal': {
            e.preventDefault();
            const proj = useProjectStore.getState();
            if (proj.activeProjectId && proj.isTerminalView) {
              const session = activeWorkspaceSession(proj.activeProjectId);
              // tabId 必须来自前台仲裁，**不能**用 store 顶层 `activeTabId`：
              // 那是全仓唯一「跨 tab 空间」的激活态（跨项目/跨单元都会留旧值），
              // 配 session 内的 tabs 属于同一 defect 家族（10-12 已判死、design §1.3）。
              const target = foregroundTerminalTab(session);
              if (target) refreshTerminalForSession(session, target.tab.id);
            }
            break;
          }

          case 'closeTab': {
            e.preventDefault();
            // 前台由布局派生（事件到达时现取当前 tab 空间的激活 tab），
            // 不再依赖全局 `activeTabId`（跨 tab 空间态，已删除）。
            const tabKey = resolveActiveTabKey();
            const tabId = tabKey ? activeTabIdOf(tabKey) : null;
            if (tabId) onCloseTab(tabId);
            break;
          }

          case 'prevTab': {
            e.preventDefault();
            // 终端聚焦时若绑定生效，须阻止事件继续到达 xterm，避免同时向 shell
            // 发送转义序列（与 switchTabNext/Prev 的处理一致）。
            e.stopPropagation();
            cycleTab(-1);
            break;
          }

          case 'nextTab': {
            e.preventDefault();
            e.stopPropagation();
            cycleTab(1);
            break;
          }

          case 'switchTabNext': {
            e.preventDefault();
            e.stopPropagation();
            useTabCycleStore.getState().cycleTab(1);
            break;
          }

          case 'switchTabPrev': {
            e.preventDefault();
            e.stopPropagation();
            useTabCycleStore.getState().cycleTab(-1);
            break;
          }

          case 'gotoFile': {
            e.preventDefault();
            useQuickOpenStore.getState().openPalette('gotoFile');
            break;
          }

          case 'recentFiles': {
            e.preventDefault();
            useQuickOpenStore.getState().openPalette('recentFiles');
            break;
          }

          case 'splitRight': {
            e.preventDefault();
            splitActiveTabRight();
            break;
          }

          case 'unsplitEditor': {
            e.preventDefault();
            unsplitActiveEditor();
            break;
          }

          case 'navigateBack': {
            e.preventDefault();
            void useNavHistoryStore.getState().goBack();
            break;
          }

          case 'navigateForward': {
            e.preventDefault();
            void useNavHistoryStore.getState().goForward();
            break;
          }

          case 'toggleDockProjects': {
            e.preventDefault();
            useDockStore.getState().toggleView(panelView('projects'));
            break;
          }

          case 'toggleDockSkills': {
            e.preventDefault();
            // 独立 skills 面板已并入 Library：该快捷键切换 Library 的 Skills 页
            if (
              useAppViewStore.getState().appView === 'library' &&
              useLibraryStore.getState().activeKind === 'skill'
            ) {
              useDockStore.getState().toggleView(appViewKey('library'));
            } else {
              openLibraryAt({ kind: 'skill' });
            }
            break;
          }

          case 'toggleDockLibrary': {
            e.preventDefault();
            useDockStore.getState().toggleView(appViewKey('library'));
            break;
          }

          case 'toggleDockSearch': {
            e.preventDefault();
            useDockStore.getState().toggleView(panelView('search'));
            break;
          }

          case 'commandPalette': {
            e.preventDefault();
            useActionPaletteStore.getState().openPalette();
            break;
          }

          case 'cycleProject':
          case 'switchProject': {
            e.preventDefault();
            if (unifiedItems.length === 0) break;

            let targetIdx: number;
            if (action.id === 'cycleProject') {
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

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [updateWtPath, onCloseTab, unifiedItems]);
}

/**
 * True when focus is in a form field that should keep normal typing keys.
 *
 * CodeMirror uses contenteditable + role=textbox; it must NOT count as
 * "editable" here — app shortcuts (tab cycle, nav history, goto file, …)
 * must still fire while coding. CM-scoped keys (save, F12) use its keymap.
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  // CodeMirror / similar code surfaces — allow global app chords.
  if (target.closest('.cm-editor, .cm-content, [data-code-editor]')) {
    return false;
  }

  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.closest("input, textarea, select, [contenteditable=true], [role='textbox']")) {
    return true;
  }
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
