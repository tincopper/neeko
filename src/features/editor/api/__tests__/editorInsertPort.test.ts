import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { listInsertPorts } from '@/shared/inputs/insertPorts';
import { useEditorStore } from '@/shared/store/editorStore';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';

import {
  editorInsertPortId,
  insertTextIntoEditorView,
  registerEditorInsertPort,
  unregisterEditorInsertPort,
} from '../editorInsertPort';

/**
 * ⑤ 代码编辑器端口（AC3）：真 `EditorView` + 真 `EditorState`，断言 **doc 变化 + 返回 true**。
 * 假实现（只检查「有没有 view」而不真的 dispatch）在这两条用例上必红。
 */

const TAB_KEY = 'proj-1\u0000';
const views: EditorView[] = [];

function makeView(doc: string, anchor = 0): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor } }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

/** 播种布局：`activeTabId` 是前台 tab 的**唯一**真源（`editorTabSelectors` 派生）。 */
function seedActiveTab(tabId: string | null): void {
  const layout = createDefaultEditorLayout();
  layout.groups.left = { tabIds: tabId ? [tabId] : [], activeTabId: tabId };
  useEditorStore.setState({ tabs: {}, editorLayout: { [TAB_KEY]: layout } });
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
});

describe('insertTextIntoEditorView', () => {
  it('inserts_at_the_caret_and_reports_true', () => {
    const view = makeView('abc', 1);

    expect(insertTextIntoEditorView(view, '/src/a.ts ')).toBe(true);
    expect(view.state.doc.toString()).toBe('a/src/a.ts bc');
  });

  it('replaces_the_current_selection', () => {
    const view = makeView('keep-REMOVE-keep');
    view.dispatch({ selection: { anchor: 5, head: 11 } });

    expect(insertTextIntoEditorView(view, 'X')).toBe(true);
    expect(view.state.doc.toString()).toBe('keep-X-keep');
  });

  it('returns_false_when_the_view_is_detached', () => {
    const view = makeView('abc');
    view.dom.remove();

    expect(insertTextIntoEditorView(view, 'x')).toBe(false);
    expect(view.state.doc.toString()).toBe('abc');
  });
});

describe('registerEditorInsertPort', () => {
  it('registers_with_the_editor_identity_and_codemirror_root', () => {
    const view = makeView('hello', 5);
    registerEditorInsertPort(TAB_KEY, 'tab-1', view);
    try {
      const ports = listInsertPorts(TAB_KEY);
      expect(ports.map((p) => p.id)).toEqual([editorInsertPortId(TAB_KEY, 'tab-1')]);
      expect(ports[0].kind).toBe('code-editor');
      // 指针 / 焦点判据必须落在 CodeMirror 的根节点上（不是某个外层容器）
      expect(ports[0].el).toBe(view.dom);
      expect(ports[0].insert('!')).toBe(true);
      expect(view.state.doc.toString()).toBe('hello!');
    } finally {
      unregisterEditorInsertPort(TAB_KEY, 'tab-1');
    }
    expect(listInsertPorts(TAB_KEY)).toEqual([]);
  });

  it('is_active_only_for_the_foreground_tab_of_its_space', () => {
    const view = makeView('x');
    registerEditorInsertPort(TAB_KEY, 'tab-1', view);
    try {
      const port = listInsertPorts(TAB_KEY)[0];
      seedActiveTab('tab-1');
      expect(port.isActive()).toBe(true);

      seedActiveTab('tab-2');
      expect(port.isActive()).toBe(false);
    } finally {
      unregisterEditorInsertPort(TAB_KEY, 'tab-1');
    }
  });
});
