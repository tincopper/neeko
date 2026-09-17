import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Terminal } from '@xterm/xterm';

import { useBrowserStore } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types';
import { canonicalFsPath } from '@/shared/utils/fileRef';
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
  /((?:[A-Z]:\\|\/|\.\/|\.\.\/)?[\w\-./\\]+\.\w+)(?:[([](\d+)(?:[,:](\d+))?[)\]])?/g;

// 终端文本里的文件路径 → canonical 绝对路径（fileRef 单一所有权：斜杠统一、
// 连续斜杠压缩；相对路径拼项目根），identity 与后端读取 base 一致。

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
        const fullPath = canonicalFsPath(projectPath, match[1]);
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
      useEditorStore.getState().setNavigateGoal({
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
      useEditorStore.getState().setNavigateGoal({
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
      activate(_event: MouseEvent, text: string) {
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
