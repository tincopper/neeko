import { useDockStore } from "../store/dockStore";
import { useBrowserStore } from "../store/browserStore";

/**
 * 将可能为相对路径的 filePath 解析为绝对路径（规范化斜杠）
 * - 已是绝对路径（C:/... 或 /...）→ 直接返回（规范化反斜杠为正斜杠）
 * - 相对路径 → 拼接 projectPath
 */
export function resolveAbsolutePath(projectPath: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized) || normalized.startsWith("/")) {
    return normalized;
  }
  return `${projectPath.replace(/\\/g, "/")}/${normalized}`;
}

/**
 * 将本地文件路径转换为 file:// URL
 * Windows: C:\path\file.html → file:///C:/path/file.html
 * Unix: /path/file.html → file:///path/file.html
 */
export function filePathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  // Windows 路径: C:/... → file:///C:/...
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  // Unix 路径: /... → file:///...
  return `file://${normalized}`;
}

/**
 * 在内嵌 Browser Panel 中打开本地 HTML 文件
 * 激活右侧 Browser dock panel 并导航到 file:// URL
 */
export function openHtmlInBrowserPanel(filePath: string): void {
  const fileUrl = filePathToFileUrl(filePath);
  // navigateTo first so the store has url+isLoading=true before BrowserPanel
  // mounts. activatePanel triggers a React re-render that mounts the panel;
  // if we called activatePanel first the mount effect would read an empty store.
  useBrowserStore.getState().navigateTo(fileUrl);
  useDockStore.getState().activatePanel("right", "browser");
}
