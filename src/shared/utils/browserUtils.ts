/**
 * 浏览器域的展示/导航工具（面板地址 ↔ 本地路径、打开面板、标题兜底）。
 *
 * **路径形态换算不在这里**：`shared/utils/fileRef` 是路径身份与形态的唯一所有权模块
 * （`canonicalFsPath` 拼根归零、`fileRefFromLspUri` uri→路径）。本文件只保留「浏览器语义」的
 * 两个方向 —— 本机路径 → 地址栏 URL（形态与 LSP 文档 uri 不同，见下），以及地址 → 路径的
 * **适配器**。消费侧要拼根/剥根时直接用 `fileRef`，不要再在此处加第二个实现。
 */
import { useBrowserStore } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import { fileRefFromLspUri } from '@/shared/utils/fileRef';

/**
 * 将本地文件路径转换为 file:// URL
 * Windows: C:\path\file.html → file:///C:/path/file.html
 * Unix: /path/file.html → file:///path/file.html
 *
 * 不复用 `fileRef::lspUriOf`：那是 **LSP 文档 uri** 的构造点（`file://` + canonical path），
 * Windows 盘符会落在 host 位（`file://C:/…`）；浏览器地址栏要的是 `file:///C:/…` 形态。
 */
export function filePathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  // Windows 路径: C:/... → file:///C:/...
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  // Unix 路径: /... → file:///...
  return `file://${normalized}`;
}

/**
 * 面板当前地址（file:// URL）→ 本地文件路径；非 file://（含 `jdt://`）或无法解析 → null。
 *
 * 形态换算**不在本文件实现**：`fileRef` 是路径形态的唯一所有权模块，这里的旧实现自带一套
 * 剥离，已有三处失真（均有用例）——
 * - 一次性 `decodeURIComponent` ⇒ 含畸形 `%` 的 URL（地址栏/页面导航来的任意串）抛 URIError；
 * - 不认 `localhost` host ⇒ `localhost/home/dev/a.html` 这种伪路径（永不与真实路径同一身份）；
 * - 丢掉 UNC host ⇒ `file://server/share/a.html` 变成 `server/share/a.html`（相对形态），
 *   与 `file-changed` 的绝对路径永不命中 ⇒ 浏览器自动刷新静默失效。
 *
 * 返回形态必须是 `canonicalFsPath` 的同一形态：消费侧把它交给 `pathsContainFile`，
 * 由身份所有者做同一文件判定。
 */
export function fileUrlToFilePath(fileUrl: string): string | null {
  const ref = fileRefFromLspUri(fileUrl);
  // 只有 scheme（`file://`）时 `fileRef` 会给出根 `/` —— 那不是「一个本地文件」，
  // 消费侧按「不是本地文件」处理（`if (!browserFilePath) return`）。
  if (!ref || ref.kind !== 'fs' || ref.path === '/') return null;
  return ref.path;
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
  useDockStore.getState().activatePanel('right', 'browser');
}

/**
 * 提取 URL 的 host（tab 标题在页面 meta 到达前的兜底显示）。
 * 解析失败或 host 为空（如 file://）时回退为原始 URL。
 */
export function hostFromUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.hostname || url;
  } catch {
    return url;
  }
}
