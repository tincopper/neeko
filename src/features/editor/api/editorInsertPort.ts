import type { EditorView } from '@codemirror/view';

import { registerInsertPort, unregisterInsertPort } from '@/shared/inputs/insertPorts';
import { useEditorStore } from '@/shared/store/editorStore';
import { selectActiveTabId } from '@/shared/store/editorTabSelectors';

/**
 * 代码编辑器（CodeMirror）的插入端口 —— 由 editor 域**自己**注册。
 *
 * # 为什么在 editor 域
 *
 * 「谁渲染 CodeMirror，谁登记」：视图身份（`tabKey` / `tabId`）、DOM 根（`view.dom`）、
 * 是否激活（布局前台 tab）三样只有这里同时持有。`shared/inputs` 因此可以完全不知道
 * `features/editor` 的存在（单向依赖：editor → shared/inputs）。
 *
 * # 插入形态
 *
 * `view.state.replaceSelection(text)` + `dispatch`：替换当前选区、无选区时插到光标处，
 * 走 CodeMirror 的常规事务（undo 栈、语法重解析、LSP 同步全部照常）。
 * 视图已从文档里摘除（关闭 / 重挂载竞态）→ `false`，仲裁继续降级。
 */

/** 端口身份（与 `agentInputRegistry` 同理：两段身份直接下传，不从字符串反解）。 */
export function editorInsertPortId(tabKey: string, tabId: string): string {
  return `code-editor:${tabKey}:${tabId}`;
}

/** 真插入；返回是否落地（唯一判据是「视图还挂在文档里」）。 */
export function insertTextIntoEditorView(view: EditorView, text: string): boolean {
  if (!view.dom.isConnected) return false;
  view.dispatch(view.state.replaceSelection(text));
  return true;
}

export function registerEditorInsertPort(tabKey: string, tabId: string, view: EditorView): void {
  registerInsertPort({
    id: editorInsertPortId(tabKey, tabId),
    kind: 'code-editor',
    sessionKey: tabKey,
    el: view.dom,
    // 激活 = 本 tab 是该空间布局派生的前台 tab（唯一真源 `editorTabSelectors`）。
    isActive: () => selectActiveTabId(useEditorStore.getState(), tabKey) === tabId,
    insert: (text) => insertTextIntoEditorView(view, text),
  });
}

export function unregisterEditorInsertPort(tabKey: string, tabId: string): void {
  unregisterInsertPort(editorInsertPortId(tabKey, tabId));
}
