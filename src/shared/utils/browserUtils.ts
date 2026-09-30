/**
 * 浏览器域的展示/导航工具（面板地址 ↔ 本地路径、打开面板、标题兜底）。
 *
 * **路径形态换算不在这里**：`shared/utils/fileRef` 是路径身份与形态的唯一所有权模块
 * （`fileUriOfPath` 路径→`file://` uri、`fileRefFromLspUri` uri→路径、`canonicalFsPath` 锚定）。
 * 本文件只保留「浏览器语义」的两个入口：本机路径 → 地址栏 URL（收路径字符串），以及地址 →
 * 本地路径的**适配器**。消费侧要拼根/剥根时直接用 `fileRef`，不要再在此处加第二个实现。
 */
import { useBrowserStore } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import { canonicalFsPath, fileRefFromLspUri, fileUriOfPath } from '@/shared/utils/fileRef';

/**
 * 将**绝对**本地路径转换为 file:// URL（相对路径会产出 host 形态 `file://a.html`，
 * 须由调用方先拼根 —— 本函数不做锚定）。
 * Windows: C:\path\file.html → file:///C:/path/file.html
 * Unix: /path/file.html → file:///path/file.html
 *
 * 形态与锚定都委托 `fileRef`（`fileUriOfPath` 负责盘符补第三斜杠，`canonicalFsPath` 负责
 * 反斜杠归一）：与 `lspUriOf` 的差别只在**输入契约** —— 本函数收路径字符串（浏览器地址栏场景），
 * `lspUriOf` 收 `FileRef` 并覆盖 jdt / 虚拟文档。
 */
export function filePathToFileUrl(filePath: string): string {
  return fileUriOfPath(canonicalFsPath('', filePath));
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
