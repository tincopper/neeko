import type { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

import { quickFixGutter, quickFixKeyBindings } from './lspQuickFixGutter';
import { diagnosticHoverTooltip, TOOLTIP_OWNER_CLASS } from './lspQuickFixPopup';
import type { LspQuickFixContext } from './quickFixMenuActions';

/**
 * 编辑器内 quickfix 装配（GoLand / VS Code 同构）：hover 提示 + 键位 + gutter 灯泡。
 *
 * 本文件只做装配：popup / menu（渲染 + 动作）/ gutter+keymap 三层实现分别住在
 * `lspQuickFixPopup` / `quickFixMenuRender`+`quickFixMenuActions` / `lspQuickFixGutter`，此处按
 * `useEditorExtensions` 装配模式组起来。旧导入路径（`../lspQuickFix`）经下方
 * 重导出保持可用，调用方零改动。
 */
export function lspQuickFix(ctx: LspQuickFixContext): Extension {
  return [
    // 声明"诊断 tooltip 由本扩展负责"：lint 补丁看到该类名即不再渲染内置 tooltip
    EditorView.editorAttributes.of({ class: TOOLTIP_OWNER_CLASS }),
    diagnosticHoverTooltip(ctx),
    keymap.of(quickFixKeyBindings(ctx)),
    quickFixGutter(ctx),
  ];
}

// 旧导入路径兼容：行为断言（`lspQuickFix.test.ts`）与外部调用方不改路径。
export type { LspQuickFixContext } from './quickFixMenuActions';
export type { EditorMenuItem, EditorMenuSection } from './quickFixMenuRender';
export {
  applyPreferredFixAt,
  diagnosticAtPosition,
  openQuickFixAt,
  runAiFixAt,
  shortcutHint,
  viewProblemAt,
} from './quickFixMenuActions';
export { showQuickFixMenu } from './quickFixMenuRender';
export {
  appendShortcutRow,
  createDiagnosticPopup,
  diagnosticHoverTooltip,
  TOOLTIP_OWNER_CLASS,
} from './lspQuickFixPopup';
export { quickFixGutter, quickFixKeyBindings } from './lspQuickFixGutter';
export type { QuickFixMenuItem } from '../api/codeAction';
