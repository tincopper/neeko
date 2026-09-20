import type { ChangeSpec, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { lspPositionToOffset } from '@/shared/utils/lspPosition';

/**
 * 把 LSP `WorkspaceEdit` 落到已打开的编辑器页 —— **一个事务**完成全部编辑
 * （单步撤销、编辑之间无坐标漂移）。
 *
 * 为什么自己写：`@codemirror/lsp-client` 不导出 `applyEdits`，也没有 codeAction
 * 面；而"多 edit 合并成一次 dispatch"是本仓库已有的不变量（补全自动导包 patch 同构）。
 *
 * 边界（已确认）：**只作用于已打开的编辑器页**。文件未打开 → 记警告并返回 false，
 * 不引入任何写盘路径。
 */

/** LSP `TextEdit`。 */
export interface LspTextEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

/** `documentChanges` 里的 `TextDocumentEdit`。 */
interface TextDocumentEdit {
  textDocument: { uri: string; version?: number | null };
  edits: LspTextEdit[];
}

/**
 * LSP `WorkspaceEdit` 的两种形态：旧 `changes`（uri → edits）与新
 * `documentChanges`（可含 create/rename/delete 资源操作，M3 不支持）。
 */
export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<TextDocumentEdit | { kind?: string }>;
}

/** 由调用方注入的视图查询（生产走编辑器注册表，测试传桩）。 */
export type EditorViewResolver = (uri: string) => EditorView | null;

/**
 * 抽出目标 uri 的编辑。未知形态 / 资源操作返回空数组（不抛）。
 */
export function editsForUri(edit: LspWorkspaceEdit, uri: string): LspTextEdit[] {
  if (!edit || !uri) return [];
  if (Array.isArray(edit.changes?.[uri])) {
    return edit.changes?.[uri] ?? [];
  }
  const docChanges = edit.documentChanges ?? [];
  const out: LspTextEdit[] = [];
  for (const change of docChanges) {
    const asEdit = change as TextDocumentEdit;
    if (!asEdit.textDocument || !Array.isArray(asEdit.edits)) continue; // create/rename/delete
    if (asEdit.textDocument.uri === uri) out.push(...asEdit.edits);
  }
  return out;
}

/**
 * 一个 WorkspaceEdit 涉及的所有目标 uri（用于 applyEdit 这种"整份编辑"的场景）。
 */
export function targetUrisOf(edit: LspWorkspaceEdit): string[] {
  if (!edit) return [];
  const uris = new Set<string>();
  for (const uri of Object.keys(edit.changes ?? {})) uris.add(uri);
  for (const change of edit.documentChanges ?? []) {
    const asEdit = change as TextDocumentEdit;
    if (asEdit.textDocument?.uri) uris.add(asEdit.textDocument.uri);
  }
  return [...uris];
}

/**
 * 把一组 LSP TextEdit 转成 CodeMirror 变更规格。
 *
 * 坐标用 `lspPositionToOffset` 夹紧：诊断/编辑滞后时 LSP 可能给出不存在的坐标，
 * 裸 `doc.line()` 会抛错并打断**整批**编辑。
 */
export function workspaceEditToChanges(doc: Text, edits: LspTextEdit[]): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  for (const edit of edits) {
    if (!edit?.range) continue;
    const from = lspPositionToOffset(doc, edit.range.start);
    const to = lspPositionToOffset(doc, edit.range.end);
    if (from === null || to === null) continue;
    changes.push({ from: Math.min(from, to), to: Math.max(from, to), insert: edit.newText ?? '' });
  }
  return changes;
}

/**
 * 应用 `WorkspaceEdit` 到目标 uri 的编辑器。
 *
 * @returns 是否落地。false = 没有打开的页 / 没有可应用的编辑（两者都不抛）。
 */
export function applyWorkspaceEdit(
  edit: LspWorkspaceEdit,
  uri: string,
  resolveView: EditorViewResolver,
): boolean {
  const view = resolveView(uri);
  if (!view) {
    console.warn('[LSP] applyEdit skipped: no open editor for', uri);
    return false;
  }
  const edits = editsForUri(edit, uri);
  const changes = workspaceEditToChanges(view.state.doc, edits);
  if (changes.length === 0) return false;
  // 一次 dispatch：所有 edit 按**同一份起始文档**解析坐标（与补全自动导包同构）
  view.dispatch({ changes });
  return true;
}
