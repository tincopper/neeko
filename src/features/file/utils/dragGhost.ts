/**
 * 自定义拖影（drag ghost）—— 拖拽时替换浏览器默认的「被拖元素整行 DOM 快照」。
 *
 * 原生 HTML5 拖拽默认以整行快照作拖影，会把行内 UI 装饰（如目录的展开/折叠
 * chevron）一并拍进去。本模块生成「图标 + 标签」的独立拖影元素，与应用视觉解耦。
 *
 * 设计原则：
 * - 高内聚：单实例的创建 / 强制 reflow / 清理全部收口于此，调用方不持有内部状态，
 *   无需关心多次调用与泄漏。
 * - 低耦合：只接受 `iconUrl` / `label` / `iconSize`，不依赖任何组件或节点类型；
 *   图标 URL 属调用方领域知识（文件树行按自身规则解析），本模块只消费结果。
 * - 可扩展：任意可拖拽列表（文件树 / 工作树 / 搜索结果）传入对应图标即可复用。
 * - 生命周期：`dragend` 或组件卸载时调用返回的清理函数（幂等）；单实例互斥，
 *   重复 `setDragGhost` 自动替换上一次拖影；未清理的残留离屏不可见，下次调用自愈。
 */

interface DragGhostOptions {
  /** 拖影图标 URL（目录 / 文件图标已由调用方解析好）。 */
  iconUrl: string;
  /** 拖影标签文本（节点名）。 */
  label: string;
  /** 图标尺寸（px），与行内图标一致（目录 16 / 文件 14）。 */
  iconSize?: number;
}

let ghostEl: HTMLElement | null = null;

function createDragGhost(opts: DragGhostOptions): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:absolute',
    'top:-9999px',
    'left:-9999px',
    'display:flex',
    'align-items:center',
    'gap:4px',
    'padding:2px 6px',
    'border-radius:4px',
    'background:var(--bg-secondary, #181a1c)',
    'white-space:nowrap',
  ].join(';');

  const icon = document.createElement('img');
  const iconSize = opts.iconSize ?? 14;
  icon.style.width = `${iconSize}px`;
  icon.style.height = `${iconSize}px`;
  icon.src = opts.iconUrl;
  icon.alt = '';
  el.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = opts.label;
  label.style.cssText =
    'font-size:var(--font-size, 13px);font-weight:500;color:var(--text-primary, #fff)';
  el.appendChild(label);

  document.body.appendChild(el);
  // 强制同步 reflow：WebKit/WKWebView（Tauri macOS 主平台）在元素未 layout 时
  // 快照拖影可能得到空白位图；jsdom 无布局引擎暴露不了此问题，需实机兜底。
  void el.offsetWidth;
  return el;
}

/**
 * 移除当前拖影元素（幂等）。供 `dragend`、组件卸载及测试清理复用。
 */
export function disposeDragGhost(): void {
  ghostEl?.remove();
  ghostEl = null;
}

/**
 * 设置自定义拖影：创建「图标 + 标签」元素挂到 body 离屏位置，调用
 * `setDragImage`（偏移默认对准图标中心，`padding 2px 6px` + 16px 图标 → 10px）。
 * 自动替换上一次拖影（单实例互斥），返回清理函数供调用方在拖拽结束时调用。
 */
export function setDragGhost(
  dataTransfer: DataTransfer,
  opts: DragGhostOptions,
  offsetX = 10,
  offsetY = 10,
): () => void {
  disposeDragGhost();
  ghostEl = createDragGhost(opts);
  dataTransfer.setDragImage(ghostEl, offsetX, offsetY);
  return disposeDragGhost;
}
