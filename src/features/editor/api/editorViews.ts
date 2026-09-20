import type { EditorView } from '@codemirror/view';

import { useProjectStore } from '@/shared/store/projectStore';
import { fileRefFromLspUri, fileRefFromTabPath, tabIdentityOf } from '@/shared/utils/fileRef';

/**
 * 已打开编辑器页的注册表：`FileRef` 身份 → `EditorView`。
 *
 * 存在的理由：`workspace/applyEdit` / codeAction 要按 **LSP document uri** 找到目标
 * 编辑器，而视图原本只活在各自 hook 的 `editorViewRef` 里，跨面板（Problems 面板发起
 * 的修复）拿不到。
 *
 * 身份一律走 `FileRef`（红线 12）：登记侧用
 * `tabIdentityOf(fileRefFromTabPath(projectRoot, filePath))`，解析侧用
 * `fileRefFromLspUri(uri)` 得到同一个身份 —— 不自造字符串归一、不做 `endsWith`
 * 之类的别名匹配。
 *
 * 项目根取**现成的项目对象**（`useProjectStore`），不在本模块做任何路径推导。
 *
 * 同文件多 tab 共用同一身份：卸载引用计数（与 `aiActionRegistry` 同构），先卸载的
 * tab 不得摘掉存活页的视图。
 */

const views = new Map<string, { view: EditorView; count: number }>();

/** 项目根路径取自项目对象；取不到返回 null（此时不登记，宁缺勿错）。 */
function projectRootOf(projectId: string): string | null {
  return useProjectStore.getState().projects.find((p) => p.id === projectId)?.path ?? null;
}

/** tab → 编辑器身份（登记侧）。取不到项目根返回 null。 */
export function editorIdentityOfTab(projectId: string, filePath: string): string | null {
  const root = projectRootOf(projectId);
  if (!root) return null;
  return tabIdentityOf(fileRefFromTabPath(root, filePath));
}

export function registerEditorView(identity: string, view: EditorView): void {
  const cur = views.get(identity);
  if (cur) views.set(identity, { view, count: cur.count + 1 });
  else views.set(identity, { view, count: 1 });
}

export function unregisterEditorView(identity: string): void {
  const cur = views.get(identity);
  if (!cur) return;
  if (cur.count <= 1) views.delete(identity);
  else views.set(identity, { view: cur.view, count: cur.count - 1 });
}

export function getEditorView(identity: string): EditorView | null {
  return views.get(identity)?.view ?? null;
}

/**
 * LSP document uri → 已打开的编辑器页；未打开（或 uri 不是文件形态）返回 null。
 *
 * 调用方负责"拿不到就跳过"：M3 只对已打开的页应用编辑，不引入写盘路径。
 */
export function resolveEditorViewFromUri(uri: string): EditorView | null {
  const ref = fileRefFromLspUri(uri);
  if (!ref) return null;
  return getEditorView(tabIdentityOf(ref));
}
