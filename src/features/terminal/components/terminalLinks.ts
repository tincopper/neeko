import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Terminal } from '@xterm/xterm';

import { useBrowserStore } from '@/features/browser/store';
import { useEditorStore } from '@/shared/store';
import { useDockStore } from '@/shared/store/dockStore';
import type { Tab } from '@/shared/types';
import { getFileName, getTabId } from '@/shared/utils/fileTree';

import { revealInFileManager, readFileContent } from '../../file/api/fileApi';

interface FilePathLinkOptions {
  projectPath: string;
  tabKey: string;
  projectId: string;
  showToast?: (message: string, type?: 'info' | 'error') => void;
}

function openInEmbeddedBrowser(url: string): void {
  useDockStore.getState().activatePanel('right', 'browser');
  useBrowserStore.getState().navigateTo(url);
}

const FILE_PATH_REGEX =
  /((?:[A-Z]:\\|\/|\.\/|\.\.\/)?[\w\-\.\/\\]+\.\w+)(?:[(\[](\d+)(?:[,:](\d+))?[)\]])?/g;

function resolveToAbsolute(matchedPath: string, projectPath: string): string {
  if (/^[A-Z]:\\/.test(matchedPath) || matchedPath.startsWith('/')) {
    return matchedPath;
  }
  const separator = projectPath.includes('\\') ? '\\' : '/';
  const base = projectPath.endsWith(separator) ? projectPath : projectPath + separator;
  return base + matchedPath;
}

function createFilePathLinkProvider(term: Terminal, options: FilePathLinkOptions) {
  const { projectPath, tabKey, projectId, showToast } = options;

  return {
    provideLinks(bufferLineNumber: number, callback: (links: any[] | undefined) => void) {
      const bufferLine = term.buffer.active.getLine(bufferLineNumber - 1);
      const line = bufferLine?.translateToString();
      if (!line) {
        callback(undefined);
        return;
      }

      const links: any[] = [];
      let match: RegExpExecArray | null;

      FILE_PATH_REGEX.lastIndex = 0;

      while ((match = FILE_PATH_REGEX.exec(line)) !== null) {
        const fullPath = resolveToAbsolute(match[1], projectPath);
        const startIndex = match.index + 1;
        const endIndex = match.index + match[0].length + 1;
        const lineNum = match[2] ? parseInt(match[2], 10) : undefined;
        const colNum = match[3] ? parseInt(match[3], 10) : undefined;

        links.push({
          range: {
            start: { x: startIndex, y: bufferLineNumber },
            end: { x: endIndex, y: bufferLineNumber },
          },
          text: match[0],
          activate: (event: MouseEvent) => {
            if (event.metaKey || event.ctrlKey) {
              openFileInEditor(fullPath, tabKey, projectId, showToast, lineNum, colNum);
            } else {
              revealInFileManager(fullPath).catch((err) => {
                console.error(`[TerminalLinks] Failed to reveal file '${fullPath}':`, err);
              });
            }
          },
        });
      }

      callback(links);
    },
  };
}

async function openFileInEditor(
  fullPath: string,
  tabKey: string,
  projId: string,
  showToast?: (message: string, type?: 'info' | 'error') => void,
  line?: number,
  col?: number,
): Promise<void> {
  const tabId = getTabId(tabKey, fullPath);
  const existing = useEditorStore.getState().tabs[tabKey];
  if (existing?.tabs.some((t) => t.id === tabId)) {
    useEditorStore.getState().activateTab(tabKey, tabId);
    if (line !== undefined) {
      useEditorStore.getState().setPendingNavigateTarget({
        tabKey,
        tabId,
        line,
        col: col ?? 0,
      });
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
      useEditorStore.getState().setPendingNavigateTarget({
        tabKey,
        tabId,
        line,
        col: col ?? 0,
      });
    }
  } catch (err) {
    const msg = `File not found: ${fullPath}`;
    console.error(`[TerminalLinks] ${msg}:`, err);
    showToast?.(msg, 'error');
  }
}

export function setupTerminalLinks(term: Terminal, options: FilePathLinkOptions): void {
  const webLinksAddon = new WebLinksAddon((_event, uri) => {
    openInEmbeddedBrowser(uri);
  });
  term.loadAddon(webLinksAddon);

  try {
    (term as any).registerLinkProvider?.(createFilePathLinkProvider(term, options));
  } catch (err) {
    console.warn('[TerminalLinks] registerLinkProvider not supported, falling back:', err);
  }

  try {
    (term as any).options.linkHandler = {
      activate(_event: MouseEvent, text: string, _range: any) {
        if (
          text.startsWith('http://') ||
          text.startsWith('https://') ||
          text.startsWith('file://')
        ) {
          openInEmbeddedBrowser(text);
        }
      },
    };
  } catch (err) {
    console.warn('[TerminalLinks] linkHandler not supported:', err);
  }
}
