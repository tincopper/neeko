import { getSearchQuery, openSearchPanel, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { neekoSearchExtension } from '../searchPanel';

let view: EditorView | null = null;

function makeView(doc = 'hello world\nhello neeko\n'): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const v = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [neekoSearchExtension(), keymap.of(searchKeymap)],
    }),
    parent,
  });
  view = v;
  openSearchPanel(v);
  return v;
}

function panel(): HTMLElement {
  const el = document.querySelector('.cm-panel.cm-search.neeko-search') as HTMLElement | null;
  if (!el) throw new Error('search panel not mounted');
  return el;
}

function replaceRow(): HTMLElement {
  return panel().querySelector('.ns-replace-row') as HTMLElement;
}

function toggleBtn(): HTMLButtonElement {
  return panel().querySelector('button[name="replace-toggle"]') as HTMLButtonElement;
}

function searchInput(): HTMLInputElement {
  return panel().querySelector('input[name="search"]') as HTMLInputElement;
}

/** 在面板中设置搜索/替换词并展开替换行 */
function setupReplaceQuery(doc: string, search: string, replace: string): EditorView {
  const v = makeView(doc);
  const s = searchInput();
  s.value = search;
  s.dispatchEvent(new Event('input', { bubbles: true }));
  const r = panel().querySelector('input[name="replace"]') as HTMLInputElement;
  r.value = replace;
  r.dispatchEvent(new Event('input', { bubbles: true }));
  toggleBtn().click();
  return v;
}

function replaceAllBtn(): HTMLButtonElement {
  return panel().querySelector('button[name="replaceAll"]') as HTMLButtonElement;
}

function cancelBtn(): HTMLButtonElement {
  return panel().querySelector('button.ns-cancel') as HTMLButtonElement;
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = '';
});

describe('neekoSearchPanel', () => {
  it('mounts with replace row collapsed by default', () => {
    makeView();
    const row = replaceRow();
    expect(row).toBeTruthy();
    // 默认只显示「查找」，替换行折叠隐藏
    expect(row.style.display).toBe('none');
    // 查找输入框标记 main-field（打开面板时聚焦）
    expect(searchInput().getAttribute('main-field')).toBe('true');
  });

  it('toggles replace row on chevron click and swaps icon', () => {
    makeView();
    expect(replaceRow().style.display).toBe('none');

    toggleBtn().click();
    expect(replaceRow().style.display).toBe('flex');
    // 展开后显示向下 chevron（lucide 图标，通过 class 断言）
    expect(toggleBtn().innerHTML).toContain('lucide-chevron-down');

    toggleBtn().click();
    expect(replaceRow().style.display).toBe('none');
    // 收起后显示向右 chevron
    expect(toggleBtn().innerHTML).toContain('lucide-chevron-right');
  });

  it('renders lucide icons (18px, currentColor)', () => {
    makeView();
    const svg = panel().querySelector('button[name="replace-toggle"] svg') as SVGSVGElement | null;
    expect(svg).toBeTruthy();
    // 固定 24 viewBox + 18px，与 28px 图标按钮成比例
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('width')).toBe('18');
    expect(svg?.getAttribute('height')).toBe('18');
    // 来自 lucide-react（class 带 lucide 前缀、stroke 继承 currentColor）
    expect(svg?.getAttribute('class')).toContain('lucide');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('sets aria-label on icon-only buttons (a11y)', () => {
    makeView();
    const iconBtns = [...panel().querySelectorAll('button.ns-icon')];
    expect(iconBtns.length).toBeGreaterThan(0);
    for (const btn of iconBtns) {
      // 图标按钮无可视文本，必须有 aria-label 提供可访问名
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    }
    // 文字按钮可见文本即访问名，不需要 aria-label
    const replaceBtn = panel().querySelector('button[name="replace"]') as HTMLButtonElement;
    expect(replaceBtn.getAttribute('aria-label')).toBeNull();
  });

  it('commits typed search query to editor state', () => {
    const v = makeView('abc def\n');
    const input = searchInput();
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(getSearchQuery(v.state).search).toBe('abc');
  });

  it('toggles case sensitivity option and updates state', () => {
    const v = makeView('abc\n');
    const caseBtn = panel().querySelector('button.ns-opt') as HTMLButtonElement;
    caseBtn.click();
    expect(caseBtn.classList.contains('ns-on')).toBe(true);
    expect(getSearchQuery(v.state).caseSensitive).toBe(true);

    caseBtn.click();
    expect(caseBtn.classList.contains('ns-on')).toBe(false);
    expect(getSearchQuery(v.state).caseSensitive).toBe(false);
  });

  it('requests confirmation with match count before replace all', () => {
    setupReplaceQuery('foo bar foo baz\nfoo\n', 'foo', 'X');
    replaceAllBtn().click();
    // 第一次点击 → 进入确认态：按钮变警示文案 + 出现取消按钮
    expect(replaceAllBtn().textContent).toContain('Replace');
    expect(replaceAllBtn().textContent).toContain('3');
    expect(replaceAllBtn().classList.contains('ns-danger')).toBe(true);
    expect(cancelBtn().style.display).not.toBe('none');
  });

  it('executes replace all on second confirm click', () => {
    const v = setupReplaceQuery('foo bar foo baz\nfoo\n', 'foo', 'X');
    replaceAllBtn().click();
    replaceAllBtn().click();
    // 全部匹配被替换，按钮复位
    expect(v.state.doc.toString()).toBe('X bar X baz\nX\n');
    expect(replaceAllBtn().textContent).toBe('Replace All');
  });

  it('cancels confirmation and keeps document unchanged', () => {
    const v = setupReplaceQuery('foo bar foo\n', 'foo', 'X');
    replaceAllBtn().click();
    cancelBtn().click();
    expect(v.state.doc.toString()).toBe('foo bar foo\n');
    expect(replaceAllBtn().textContent).toBe('Replace All');
    expect(replaceAllBtn().classList.contains('ns-danger')).toBe(false);
  });

  it('does not confirm when there are no matches', () => {
    setupReplaceQuery('abc def\n', 'zzz', 'X');
    replaceAllBtn().click();
    // 无匹配 → 不进入确认态
    expect(replaceAllBtn().textContent).toBe('Replace All');
    expect(cancelBtn().style.display).toBe('none');
  });
});
