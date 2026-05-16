import type { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { useBrowserStore } from "../../store/browserStore";
import { useDockStore } from "../../store/dockStore";

/**
 * 在内嵌浏览器中打开 URL
 * 1. 更新 browserStore 的 url
 * 2. 激活右侧 Browser 面板
 */
function openInEmbeddedBrowser(url: string): void {
  // 激活 Browser 面板
  useDockStore.getState().activatePanel("right", "browser");
  // 导航到 URL
  useBrowserStore.getState().navigateTo(url);
}

/**
 * 文件路径正则匹配
 * 支持：
 * - 绝对路径: C:\Users\...\file.rs:10:5 或 /home/.../file.rs:10:5
 * - 相对路径: src/main.rs:10:5、./path/to/file:20
 * - MSVC 格式: file.rs(10,5)
 */
const FILE_PATH_REGEX =
  /((?:[A-Z]:\\|\/|\.\/|\.\.\/)?[\w\-\.\/\\]+\.\w+)(?:[(\[](\d+)(?:[,:](\d+))?[)\]])?/g;

/**
 * 解析文件路径为绝对路径
 * 如果是相对路径，则拼接 projectPath
 */
function resolveToAbsolute(matchedPath: string, projectPath: string): string {
  // 如果已经是绝对路径，直接返回
  if (/^[A-Z]:\\/.test(matchedPath) || matchedPath.startsWith("/")) {
    return matchedPath;
  }
  // 相对路径拼接 projectPath
  const separator = projectPath.includes("\\") ? "\\" : "/";
  const base = projectPath.endsWith(separator) ? projectPath : projectPath + separator;
  return base + matchedPath;
}

/**
 * 创建文件路径 LinkProvider
 * 检测终端输出中的文件路径并支持点击
 */
function createFilePathLinkProvider(projectPath: string) {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: any[] | undefined) => void) {
      // 获取行内容
      const line = (globalThis as any).__termLine?.[bufferLineNumber];
      if (!line) {
        callback(undefined);
        return;
      }

      const links: any[] = [];
      let match: RegExpExecArray | null;

      // 重置正则状态
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
            invoke("reveal_in_file_manager", { path: fullPath }).catch((err) => {
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
 * 为终端实例设置链接处理
 * - URL 链接 → 在内嵌浏览器中打开
 * - 文件路径 → 在系统文件管理器中 reveal
 * - OSC 8 超链接 → 在内嵌浏览器中打开
 */
export function setupTerminalLinks(term: Terminal, projectPath: string): void {
  // ─── A. URL 链接 → 在内嵌浏览器中打开 ───
  const webLinksAddon = new WebLinksAddon((_event, uri) => {
    openInEmbeddedBrowser(uri);
  });
  term.loadAddon(webLinksAddon);

  // ─── B. 文件路径 LinkProvider ───
  // 注意：registerLinkProvider 需要 xterm.js 4.14+ 支持
  // 如果不支持，我们可以降级到 WebLinksAddon 的自定义 handler
  try {
    (term as any).registerLinkProvider?.(createFilePathLinkProvider(projectPath));
  } catch (err) {
    console.warn("[TerminalLinks] registerLinkProvider not supported, falling back:", err);
  }

  // ─── C. OSC 8 超链接 → 在内嵌浏览器中打开 ───
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
