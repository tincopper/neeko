/**
 * 页内查找面板（VS Code 风格，自建）。
 *
 * 覆盖 `@codemirror/search` 的默认面板（默认 replace 常驻显示）：
 * - 默认只显示「查找」行；
 * - 左侧 chevron 折叠开关，点击展开/收起「替换」行（参考 VS Code find widget）；
 * - 大小写 / 正则 / 全词 三个开关，激活态高亮；
 * - 上一处 / 下一处 / 全部选中，替换 / 全部替换。
 *
 * 纯 DOM 构建（CodeMirror Panel 体系内，非 React 渲染树）。
 */
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import type { EditorView, Panel } from '@codemirror/view';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  SquareCheckBig,
  X,
  type LucideProps,
} from 'lucide-react';
import React from 'react';
// 显式使用浏览器专用入口：避免 react-dom/server 的 Node 流式构建（server.node.js）进入浏览器包，
// 确保浏览器与 jsdom 测试环境共用同一个轻量 server.browser 构建。
import { renderToStaticMarkup } from 'react-dom/server.browser';

/** 面板图标尺寸：18px，与 28px 图标按钮、26px 输入框成比例，清晰醒目 */
const ICON_SIZE = 18;
/** 小图标描边：lucide 默认 strokeWidth（18px 下清晰粗实） */
const ICON_STROKE_WIDTH = 2;

/**
 * 将 lucide 图标组件渲染为静态 SVG 字符串。
 * 面板为纯 DOM 构建（CodeMirror Panel 体系内，非 React 渲染树），
 * 故用 renderToStaticMarkup 复用项目统一图标库，避免手写 SVG path。
 */
function iconSvg(Icon: React.ComponentType<LucideProps>): string {
  return renderToStaticMarkup(
    React.createElement(Icon, { size: ICON_SIZE, strokeWidth: ICON_STROKE_WIDTH }),
  );
}

const ICONS = {
  chevronDown: iconSvg(ChevronDown),
  chevronRight: iconSvg(ChevronRight),
  prev: iconSvg(ChevronUp),
  next: iconSvg(ChevronDown),
  selectAll: iconSvg(SquareCheckBig),
  close: iconSvg(X),
};

function elt<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: (Node | string | (Node | string)[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === undefined) continue;
    if (key === 'class') node.className = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity) as (Node | string)[]) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

/** 一行式小按钮（图标或文字） */
function iconButton(
  html: string,
  onClick: () => void,
  title: string,
  name?: string,
  variant: 'icon' | 'text' = 'icon',
): HTMLButtonElement {
  const btn = elt('button', {
    class: `cm-button ns-btn ns-${variant}`,
    type: 'button',
    ...(name ? { name } : {}),
  });
  btn.innerHTML = html;
  btn.title = title;
  // 图标按钮无可视文本，必须以 aria-label 提供可访问名（web interface guidelines）；
  // 文字按钮的可见文本即访问名，无需重复。
  if (variant === 'icon') btn.setAttribute('aria-label', title);
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', onClick);
  return btn;
}

class NeekoSearchPanel implements Panel {
  readonly dom: HTMLElement;
  top = true;

  private readonly view: EditorView;
  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly replaceRow: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly caseBtn: HTMLButtonElement;
  private readonly reBtn: HTMLButtonElement;
  private readonly wordBtn: HTMLButtonElement;
  private readonly replaceAllBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private replaceOpen = false;
  /** 「全部替换」二次确认计时器（null = 未处于确认态） */
  private confirmTimer: number | null = null;

  constructor(view: EditorView) {
    this.view = view;
    const q = getSearchQuery(view.state);

    this.searchField = elt('input', {
      class: 'cm-textfield ns-input',
      name: 'search',
      'main-field': 'true',
      placeholder: 'Find',
      'aria-label': 'Find',
      value: q.search,
      spellcheck: 'false',
    });
    this.searchField.addEventListener('input', () => this.commit());

    this.replaceField = elt('input', {
      class: 'cm-textfield ns-input',
      name: 'replace',
      placeholder: 'Replace',
      'aria-label': 'Replace',
      value: q.replace,
      spellcheck: 'false',
    });
    this.replaceField.addEventListener('input', () => this.commit());

    // 折叠开关（VS Code：▸ 收起 / ▾ 展开）
    this.toggleBtn = iconButton(
      ICONS.chevronRight,
      () => this.setReplaceOpen(!this.replaceOpen),
      'Toggle Replace',
      'replace-toggle',
    );

    const prevBtn = iconButton(
      ICONS.prev,
      () => findPrevious(view),
      'Previous (Shift+Enter)',
      'prev',
    );
    const nextBtn = iconButton(ICONS.next, () => findNext(view), 'Next (Enter)', 'next');
    const selectAllBtn = iconButton(
      ICONS.selectAll,
      () => selectMatches(view),
      'Select All Matches',
      'select',
    );

    this.caseBtn = this.optionButton('Aa', q.caseSensitive, 'Match Case');
    this.reBtn = this.optionButton('.*', q.regexp, 'Use Regular Expression');
    this.wordBtn = this.optionButton('ab', q.wholeWord, 'Match Whole Word');
    const closeBtn = iconButton(ICONS.close, () => closeSearchPanel(view), 'Close (Esc)', 'close');

    const findRow = elt('div', { class: 'ns-row' }, [
      this.toggleBtn,
      this.searchField,
      prevBtn,
      nextBtn,
      selectAllBtn,
      elt('span', { class: 'ns-sep' }),
      this.caseBtn,
      this.reBtn,
      this.wordBtn,
      closeBtn,
    ]);

    const replaceBtn = iconButton(
      'Replace',
      () => replaceNext(view),
      'Replace (Enter)',
      'replace',
      'text',
    );
    this.replaceAllBtn = iconButton(
      'Replace All',
      () => this.requestReplaceAll(view),
      'Replace All Matches (click again to confirm)',
      'replaceAll',
      'text',
    );
    this.cancelBtn = elt('button', { class: 'cm-button ns-btn ns-text ns-cancel', type: 'button' });
    this.cancelBtn.textContent = 'Cancel';
    this.cancelBtn.title = 'Cancel Replace All (Esc)';
    this.cancelBtn.style.display = 'none';
    this.cancelBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.cancelBtn.addEventListener('click', () => this.resetReplaceAllConfirm());
    this.replaceRow = elt('div', { class: 'ns-row ns-replace-row' }, [
      this.replaceField,
      replaceBtn,
      this.replaceAllBtn,
      this.cancelBtn,
    ]);

    this.dom = elt('div', { class: 'cm-search neeko-search' }, [findRow, this.replaceRow]);

    // 键盘：Enter = 下一个 / 替换下一个；Esc = 取消待确认的全部替换
    const cancelOnEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && this.confirmTimer !== null) {
        e.preventDefault();
        this.resetReplaceAllConfirm();
      }
    };
    this.searchField.addEventListener('keydown', (e) => {
      cancelOnEsc(e);
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.replaceOpen && (e.metaKey || e.ctrlKey)) replaceNext(view);
        else findNext(view);
      }
    });
    this.replaceField.addEventListener('keydown', (e) => {
      cancelOnEsc(e);
      if (e.key === 'Enter') {
        e.preventDefault();
        replaceNext(view);
      }
    });

    this.syncToggleIcon();
  }

  destroy(): void {
    this.resetReplaceAllConfirm();
  }

  /** 提交当前表单 → 更新搜索状态 */
  private commit(): void {
    // 查询变化后，待确认的替换计数已失效，取消确认态
    this.resetReplaceAllConfirm();
    const query = new SearchQuery({
      search: this.searchField.value,
      replace: this.replaceField.value,
      caseSensitive: this.caseBtn.dataset.on === '1',
      regexp: this.reBtn.dataset.on === '1',
      wholeWord: this.wordBtn.dataset.on === '1',
    });
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  /**
   * 「全部替换」二次确认（防误触）：
   * 第一次点击 → 显示「确认替换 N 处？」+ 取消按钮（3s 超时自动复位）；
   * 再点一次 → 真正执行 replaceAll。
   */
  private requestReplaceAll(view: EditorView): void {
    if (this.confirmTimer !== null) {
      this.resetReplaceAllConfirm();
      replaceAll(view);
      return;
    }
    const query = getSearchQuery(view.state);
    if (!query.valid) return;
    const count = this.countMatches(query);
    if (count === 0) return;

    this.replaceAllBtn.textContent = `Replace ${count}?`;
    this.replaceAllBtn.classList.add('ns-danger');
    this.cancelBtn.style.display = '';
    this.confirmTimer = window.setTimeout(() => this.resetReplaceAllConfirm(), 3000);
  }

  private resetReplaceAllConfirm(): void {
    if (this.confirmTimer !== null) {
      window.clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
    this.replaceAllBtn.textContent = 'Replace All';
    this.replaceAllBtn.classList.remove('ns-danger');
    this.cancelBtn.style.display = 'none';
  }

  /** 统计当前查询命中数（预览待替换数量，走完整查询语义：大小写/正则/全词） */
  private countMatches(query: SearchQuery): number {
    let n = 0;
    const cursor = query.getCursor(this.view.state, 0, this.view.state.doc.length);
    while (!cursor.next().done) n++;
    return n;
  }

  /** 选项开关按钮（区分大小写 / 正则 / 全词） */
  private optionButton(label: string, initial: boolean, title: string): HTMLButtonElement {
    const btn = elt('button', {
      class: 'cm-button ns-btn ns-opt',
      type: 'button',
      'data-on': initial ? '1' : '0',
    });
    btn.textContent = label;
    btn.title = title;
    btn.classList.toggle('ns-on', initial);
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      const next = btn.dataset.on !== '1';
      btn.dataset.on = next ? '1' : '0';
      btn.classList.toggle('ns-on', next);
      this.commit();
    });
    return btn;
  }

  private setReplaceOpen(open: boolean): void {
    this.replaceOpen = open;
    this.replaceRow.style.display = open ? 'flex' : 'none';
    this.toggleBtn.innerHTML = open ? ICONS.chevronDown : ICONS.chevronRight;
    if (open) this.replaceField.focus();
  }

  private syncToggleIcon(): void {
    this.toggleBtn.innerHTML = ICONS.chevronRight;
    this.replaceRow.style.display = 'none';
  }
}

/**
 * 页内查找扩展（VS Code 风格折叠替换）。
 * 替换默认折叠，点击左侧 chevron 展开。
 */
export function neekoSearchExtension(): Extension {
  return search({
    top: true,
    createPanel: (view) => new NeekoSearchPanel(view),
  });
}
