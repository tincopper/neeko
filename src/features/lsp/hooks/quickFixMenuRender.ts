import type { QuickFixMenuItem } from '../api/codeAction';
import { BULB_SVG_MARKUP, sparklesSvgMarkup } from '../components/QuickFixBulbIcon';
import {
  firstEnabledIndex,
  flattenMenuItems,
  stepEnabledIndex,
} from '../components/quickFixMenuNav';
import { computeMenuPosition } from '../components/quickFixMenuPosition';

/**
 * 编辑器内 quickfix 的菜单**渲染**层：菜单 DOM、样式常量与弹出容器
 * （`showQuickFixMenu`，VS Code 平铺形态）。
 *
 * 从 `lspQuickFixMenu.ts` 拆出（F7a）：本层只管"菜单长什么样、怎么交互"，
 * 不认识诊断定位与派发（`./quickFixMenuActions` 单向依赖本层，反向零依赖 ——
 * 本层禁止 import `../api/codeAction` 的动作函数与 `../store/lspStore`）。
 */

/** 编辑器侧菜单条目：比共享模型多一个点击回调（UI 关注点，不进 API 层类型）。 */
export interface EditorMenuItem extends QuickFixMenuItem {
  onPick?: () => void;
}
export interface EditorMenuSection {
  header: string;
  items: EditorMenuItem[];
}

interface RenderedRows {
  /** 摊平下标 → 行元素（键盘导航与高亮用）。 */
  rowByIndex: Map<number, HTMLButtonElement>;
}

/**
 * 渲染菜单行（VS Code 平铺形态）：一个分组、无组头、无分隔线 —— 服务器动作在前，
 * ✨ Fix / ✨ Explain（AI 项）在末尾。行内元素与类名对齐原型 `.pop-r` / `.pop code`。
 */
function appendSections(
  container: HTMLElement,
  sections: EditorMenuSection[],
  onPick: (item: EditorMenuItem) => void,
): RenderedRows {
  const rowByIndex = new Map<number, HTMLButtonElement>();
  let flatIndex = -1;

  for (const section of sections) {
    for (const item of section.items) {
      flatIndex += 1;
      rowByIndex.set(flatIndex, buildRow(item, flatIndex, onPick, container));
    }
  }

  return { rowByIndex };
}

/** 单行（原型 `.pop-r`）：可执行项带灯泡（AI 动作带 sparkle）与 `<code>` 标题，置灰项为普通文本。 */
function buildRow(
  item: EditorMenuItem,
  itemIndex: number,
  onPick: (item: EditorMenuItem) => void,
  container: HTMLElement,
): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.setAttribute('role', 'menuitem');
  // AI 条目用专属 testid：服务器动作也可能叫 "Fix"，避免碰撞
  row.setAttribute(
    'data-testid',
    item.ai ? `editor-quickfix-ai-${item.ai}` : `editor-quickfix-${item.title}`,
  );
  row.className = item.disabledHint ? DISABLED_CLASS : ITEM_CLASS;
  row.disabled = Boolean(item.disabledHint);
  row.setAttribute('data-item-index', String(itemIndex));
  if (item.disabledHint) row.title = item.disabledHint;

  if (!item.disabledHint) {
    const icon = document.createElement('span');
    icon.className = item.ai
      ? 'shrink-0 text-[var(--accent-blue)]'
      : 'shrink-0 text-[var(--accent-yellow)]';
    icon.innerHTML = item.ai ? sparklesSvgMarkup() : BULB_SVG;
    row.appendChild(icon);
  }

  const label = document.createElement(item.disabledHint ? 'span' : 'code');
  label.className = item.disabledHint ? 'min-w-0 flex-1 truncate' : TITLE_CLASS;
  label.textContent = item.title;
  row.appendChild(label);

  const hintText = item.disabledHint ?? item.hint;
  if (hintText) {
    const hint = document.createElement('span');
    hint.className = SUB2_CLASS;
    hint.textContent = hintText;
    row.appendChild(hint);
  }

  if (!item.disabledHint && item.onPick) {
    row.addEventListener('mousedown', (e) => e.preventDefault()); // 不抢编辑器焦点
    row.addEventListener('click', () => onPick(item));
  }
  container.appendChild(row);
  return row;
}

/** 与 Problems 面板行内菜单同一套外观（见 DiagnosticQuickFix.tsx）。 */
// 以下类名逐项对齐原型 `.pop*` 规格（prototype.html §M3-2）
const MENU_CLASS =
  'fixed z-50 min-w-40 max-w-64 py-0 overflow-y-auto rounded-md ' +
  'border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] ' +
  'shadow-[0_8px_24px_oklch(0_0_0/0.5)] text-[11.5px]';
const ITEM_CLASS =
  'w-full flex items-center gap-2 px-2.5 py-[5px] text-left border-b border-[var(--border-color)] ' +
  'last:border-b-0 hover:bg-[var(--bg-hover)] cursor-pointer';
const DISABLED_CLASS = `${ITEM_CLASS} text-[var(--text-muted)] cursor-default`;
const HINT_CLASS = 'px-2.5 py-1.5 text-[var(--text-muted)]';
/** `.pop-r .sub2`：右对齐的次要信息 */
const SUB2_CLASS = 'ml-auto shrink-0 text-[10.5px] text-[var(--text-muted)]';
/** `.pop code`：动作标题按等宽 + 字符串色渲染 */
const TITLE_CLASS = 'min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--cm-string)]';
/** 行内灯泡图标：与 React 侧共用同一份 path（原型 #i-bulb）。 */
const BULB_SVG = BULB_SVG_MARKUP;

/** 关闭当前菜单（同一时刻最多一个；新开一个会先关旧）。 */
let closeActiveMenu: (() => void) | null = null;

/**
 * 在锚点处弹出动作菜单。菜单挂在 `document.body` 上（fixed + portal 语义）：
 * 编辑器本身也可能处于 overflow 容器内，留在内部会被裁切。
 */
export function showQuickFixMenu(
  anchor: { getBoundingClientRect: () => DOMRect },
  sections: EditorMenuSection[],
  options: { loading?: boolean } = {},
): () => void {
  closeActiveMenu?.();

  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('data-testid', 'editor-quickfix-menu');
  menu.className = MENU_CLASS;
  menu.style.visibility = 'hidden';

  const flatItems = flattenMenuItems(sections);
  /** 键盘高亮：以**摊平下标**为准（跨组连续移动），初始停在服务器声明的首选/首个可执行项 */
  let activeIndex = firstEnabledIndex(flatItems);
  const rowByIndex = new Map<number, HTMLElement>();

  const close = (): void => {
    menu.remove();
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    if (closeActiveMenu === close) closeActiveMenu = null;
  };
  const onPointerDown = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    // 键盘导航（原型步骤 2 的选中态语义）：↑/↓ 跳过置灰项，Enter 应用高亮项
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const moved = stepEnabledIndex(flatItems, activeIndex, e.key === 'ArrowDown' ? 1 : -1);
      if (moved !== activeIndex) {
        activeIndex = moved;
        paintActive();
      }
      return;
    }
    if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      rowByIndex.get(activeIndex)?.click();
    }
  };
  const paintActive = (): void => {
    for (const [index, row] of rowByIndex) {
      row.classList.toggle('bg-[var(--bg-hover)]', index === activeIndex);
    }
  };

  if (options.loading) {
    const hint = document.createElement('div');
    hint.className = HINT_CLASS;
    hint.setAttribute('data-testid', 'editor-quickfix-loading');
    hint.textContent = 'Loading…';
    menu.appendChild(hint);
  } else {
    // AI 动作固定在列（groupQuickFixActions 追加），不再有"零条目空菜单"形态。
    // 选中即关（VS Code 同构）：点击/Enter 应用后菜单必须隐藏，不固定在页面上。
    const { rowByIndex: rows } = appendSections(menu, sections, (item) => {
      item.onPick?.();
      close();
    });
    for (const [index, row] of rows) rowByIndex.set(index, row);
  }

  document.body.appendChild(menu);

  const { top, left, maxHeight } = computeMenuPosition(
    anchor.getBoundingClientRect(),
    { width: menu.offsetWidth, height: menu.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.style.maxHeight = `${maxHeight}px`;
  menu.style.visibility = 'visible';
  paintActive();

  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);

  closeActiveMenu = close;
  return close;
}
