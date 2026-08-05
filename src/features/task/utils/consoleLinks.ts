/**
 * Console link handling for task output — detects URLs and file paths
 * in xterm.js output, enabling click-to-open behavior.
 *
 * URLs → open in embedded browser
 * File paths → Ctrl/Cmd+Click opens in editor, plain click reveals in file manager
 *
 * Underlines are provided by registerLinkProvider (visual feedback only);
 * actual activation is handled manually via a mousedown listener that maps
 * the mouse position to buffer coordinates. This avoids relying on xterm.js's
 * internal link activation, which is unreliable for read-only terminals.
 */
import type { ILinkProvider, Terminal } from '@xterm/xterm';

import { useEditorStore } from '@/shared/store';
import { useBrowserStore } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import type { Tab } from '@/shared/types';
import { getFileName, getTabId } from '@/shared/utils/fileTree';

// eslint-disable-next-line import/no-restricted-paths -- console links need file API
import { revealInFileManager, readFileContent } from '../../file/api/fileApi';

interface ConsoleLinkOptions {
  projectPath: string;
  projectId: string;
}

interface FileMatch {
  text: string;
  fullPath: string;
  line?: number;
  col?: number;
}

const FILE_PATH_REGEX =
  /((?:[A-Z]:\\|\/|\.\/|\.\.\/)?[\w\-./\\]+\.\w+)(?:[([](\d+)(?:[,:](\d+))?[)\]])?/g;

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

function openInEmbeddedBrowser(url: string): void {
  useDockStore.getState().activatePanel('right', 'browser');
  useBrowserStore.getState().navigateTo(url);
}

function resolveToAbsolute(matchedPath: string, projectPath: string): string {
  if (/^[A-Z]:\\/.test(matchedPath) || matchedPath.startsWith('/')) {
    return matchedPath;
  }
  const separator = projectPath.includes('\\') ? '\\' : '/';
  const base = projectPath.endsWith(separator) ? projectPath : projectPath + separator;
  return base + matchedPath;
}

/** Find the first file-path match whose range contains `column` (1-based). */
function matchFileAtColumn(line: string, column: number): FileMatch | null {
  FILE_PATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_REGEX.exec(line)) !== null) {
    const start = match.index + 1; // 1-based
    const end = match.index + match[0].length + 1; // exclusive end
    if (column >= start && column < end) {
      return {
        text: match[0],
        fullPath: match[1],
        line: match[2] ? parseInt(match[2], 10) : undefined,
        col: match[3] ? parseInt(match[3], 10) : undefined,
      };
    }
  }
  return null;
}

/** Provide links for underline rendering (file paths only; URLs via WebLinksAddon). */
function createFilePathLinkProvider(term: Terminal): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback) {
      const bufferLine = term.buffer.active.getLine(bufferLineNumber - 1);
      const line = bufferLine?.translateToString();
      if (!line) {
        callback(undefined);
        return;
      }

      const links: Parameters<Parameters<ILinkProvider['provideLinks']>[1]>[0] = [];
      let match: RegExpExecArray | null;
      FILE_PATH_REGEX.lastIndex = 0;

      while ((match = FILE_PATH_REGEX.exec(line)) !== null) {
        const startIndex = match.index + 1;
        const endIndex = match.index + match[0].length + 1;
        links.push({
          range: {
            start: { x: startIndex, y: bufferLineNumber },
            end: { x: endIndex, y: bufferLineNumber },
          },
          text: match[0],
          // No-op: real activation handled by the manual mousedown listener.
          activate: () => {},
        });
      }

      callback(links);
    },
  };
}

async function openFileInEditor(
  fullPath: string,
  projId: string,
  line?: number,
  col?: number,
): Promise<void> {
  const tabKey = projId;
  const tabId = getTabId(tabKey, fullPath);
  const existing = useEditorStore.getState().tabs[tabKey];
  if (existing?.tabs.some((t) => t.id === tabId)) {
    useEditorStore.getState().activateTab(tabKey, tabId);
    if (line !== undefined) {
      useEditorStore.getState().setPendingNavigateTarget({ tabKey, tabId, line, col: col ?? 0 });
    }
    return;
  }

  try {
    const content = await readFileContent(projId, fullPath);
    const newTab: Tab = {
      id: tabId,
      projectId: projId,
      title: getFileName(fullPath),
      order: existing?.tabs.length ?? 0,
      data: {
        kind: 'file',
        filePath: fullPath,
        fileName: getFileName(fullPath),
        content,
        isDirty: false,
      },
    };
    useEditorStore.getState().addTab(tabKey, newTab);
    if (line !== undefined) {
      useEditorStore.getState().setPendingNavigateTarget({ tabKey, tabId, line, col: col ?? 0 });
    }
  } catch (err) {
    console.error(`[ConsoleLinks] File not found: ${fullPath}`, err);
  }
}

export function setupConsoleLinks(term: Terminal, options: ConsoleLinkOptions): void {
  const { projectPath, projectId } = options;
  const container = term.element;
  if (!container) return;

  // Underline visual feedback (file paths).
  try {
    term.registerLinkProvider(createFilePathLinkProvider(term));
  } catch {
    // registerLinkProvider requires allowProposedApi (already enabled)
  }

  // Manual activation via mousedown — maps click position to buffer coords.
  const positionFromEvent = (event: MouseEvent): { line: number; column: number } | null => {
    const rowsEl = container.querySelector('.xterm-rows') as HTMLElement | null;
    if (!rowsEl) return null;
    const rect = rowsEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const cellWidth = rect.width / term.cols;
    const cellHeight = rect.height / term.rows;
    if (cellWidth <= 0 || cellHeight <= 0) return null;

    const column = Math.floor((event.clientX - rect.left) / cellWidth) + 1;
    const visibleRow = Math.floor((event.clientY - rect.top) / cellHeight);
    // Absolute buffer line (0-based) for the visible row, accounting for scroll.
    const line = term.buffer.active.viewportY + visibleRow;
    return { line, column };
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return; // left click only
    const pos = positionFromEvent(event);
    if (!pos) return;
    const bufferLine = term.buffer.active.getLine(pos.line);
    const text = bufferLine?.translateToString();
    if (!text) return;

    // URL?
    URL_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_REGEX.exec(text)) !== null) {
      const start = m.index + 1;
      const end = m.index + m[0].length + 1;
      if (pos.column >= start && pos.column < end) {
        event.preventDefault();
        event.stopPropagation();
        openInEmbeddedBrowser(m[0]);
        return;
      }
    }

    // File path?
    const fileMatch = matchFileAtColumn(text, pos.column);
    if (fileMatch) {
      event.preventDefault();
      event.stopPropagation();
      const fullPath = resolveToAbsolute(fileMatch.fullPath, projectPath);
      if (event.metaKey || event.ctrlKey) {
        void openFileInEditor(fullPath, projectId, fileMatch.line, fileMatch.col);
      } else {
        void revealInFileManager(fullPath).catch((err) => {
          console.error(`[ConsoleLinks] Failed to reveal file '${fullPath}':`, err);
        });
      }
    }
  };

  container.addEventListener('mousedown', handleMouseDown);
}
