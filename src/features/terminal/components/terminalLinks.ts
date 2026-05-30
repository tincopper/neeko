import type { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { revealInFileManager } from "../../file/api/fileApi";
import { useBrowserStore } from '@/features/browser/store';
import { useDockStore } from '@/shared/store/dockStore';

/**
 * ����Ƕ������д� URL
 * 1. ���� browserStore �� url
 * 2. �����Ҳ� Browser ���
 */
function openInEmbeddedBrowser(url: string): void {
  // ���� Browser ���
  useDockStore.getState().activatePanel("right", "browser");
  // ������ URL
  useBrowserStore.getState().navigateTo(url);
}

/**
 * �ļ�·������ƥ��
 * ֧�֣�
 * - ����·��: C:\Users\...\file.rs:10:5 �� /home/.../file.rs:10:5
 * - ���·��: src/main.rs:10:5��./path/to/file:20
 * - MSVC ��ʽ: file.rs(10,5)
 */
const FILE_PATH_REGEX =
  /((?:[A-Z]:\\|\/|\.\/|\.\.\/)?[\w\-\.\/\\]+\.\w+)(?:[(\[](\d+)(?:[,:](\d+))?[)\]])?/g;

/**
 * �����ļ�·��Ϊ����·��
 * ��������·������ƴ�� projectPath
 */
function resolveToAbsolute(matchedPath: string, projectPath: string): string {
  // ����Ѿ��Ǿ���·����ֱ�ӷ���
  if (/^[A-Z]:\\/.test(matchedPath) || matchedPath.startsWith("/")) {
    return matchedPath;
  }
  // ���·��ƴ�� projectPath
  const separator = projectPath.includes("\\") ? "\\" : "/";
  const base = projectPath.endsWith(separator) ? projectPath : projectPath + separator;
  return base + matchedPath;
}

/**
 * �����ļ�·�� LinkProvider
 * ����ն�����е��ļ�·����֧�ֵ��
 */
function createFilePathLinkProvider(projectPath: string) {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: any[] | undefined) => void) {
      // ��ȡ������
      const line = (globalThis as any).__termLine?.[bufferLineNumber];
      if (!line) {
        callback(undefined);
        return;
      }

      const links: any[] = [];
      let match: RegExpExecArray | null;

      // ��������״̬
      FILE_PATH_REGEX.lastIndex = 0;

      while ((match = FILE_PATH_REGEX.exec(line)) !== null) {
        const fullPath = resolveToAbsolute(match[1], projectPath);
        const startIndex = match.index + 1; // 1-indexed for xterm
        const endIndex = match.index + match[0].length + 1;

        links.push({
          range: {
            start: { x: startIndex, y: bufferLineNumber },
            end: { x: endIndex, y: bufferLineNumber },
          },
          text: match[0],
          activate: () => {
            revealInFileManager(fullPath).catch((err) => {
              console.error("[TerminalLinks] Failed to reveal file:", err);
            });
          },
        });
      }

      callback(links);
    },
  };
}

/**
 * Ϊ�ն�ʵ���������Ӵ���
 * - URL ���� �� ����Ƕ������д�
 * - �ļ�·�� �� ��ϵͳ�ļ��������� reveal
 * - OSC 8 ������ �� ����Ƕ������д�
 */
export function setupTerminalLinks(term: Terminal, projectPath: string): void {
  // ������ A. URL ���� �� ����Ƕ������д� ������
  const webLinksAddon = new WebLinksAddon((_event, uri) => {
    openInEmbeddedBrowser(uri);
  });
  term.loadAddon(webLinksAddon);

  // ������ B. �ļ�·�� LinkProvider ������
  // ע�⣺registerLinkProvider ��Ҫ xterm.js 4.14+ ֧��
  // �����֧�֣����ǿ��Խ����� WebLinksAddon ���Զ��� handler
  try {
    (term as any).registerLinkProvider?.(createFilePathLinkProvider(projectPath));
  } catch (err) {
    console.warn("[TerminalLinks] registerLinkProvider not supported, falling back:", err);
  }

  // ������ C. OSC 8 ������ �� ����Ƕ������д� ������
  try {
    (term as any).options.linkHandler = {
      activate(_event: MouseEvent, text: string, _range: any) {
        if (text.startsWith("http://") || text.startsWith("https://") || text.startsWith("file://")) {
          openInEmbeddedBrowser(text);
        }
      },
    };
  } catch (err) {
    console.warn("[TerminalLinks] linkHandler not supported:", err);
  }
}
