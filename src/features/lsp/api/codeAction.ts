import { runAiActionForUri } from '@/features/editor/api/aiActionRegistry';
import { resolveEditorViewFromUri } from '@/features/editor/api/editorViews';

import type { EditorViewResolver, LspWorkspaceEdit } from '../hooks/lspWorkspaceEdit';
import { applyWorkspaceEdit } from '../hooks/lspWorkspaceEdit';
import type { LspDiagnostic, LspRange } from '../types';

import { lspRequest } from './lspApi';

/**
 * `textDocument/codeAction` 通道（M3 / AC3）。
 *
 * 为什么自己写：`@codemirror/lsp-client` 不导出 codeAction 面。请求走既有
 * `lspRequest`（后端 `lsp_transport` 无方法白名单，`textDocument/codeAction`
 * 原样透传），应用走 `applyWorkspaceEdit` 的**单事务**路径。
 */

/** LSP `CodeAction`（只声明我们消费的字段）。 */
export interface LspCodeAction {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  disabled?: { reason?: string };
  /** 客户端可直接应用的编辑（gopls「Add import」就是这种形态）。 */
  edit?: LspWorkspaceEdit;
  /** 需要 `workspace/executeCommand` —— M3 不支持。 */
  command?: { title?: string; command: string; arguments?: unknown[] };
}

/** AI 动作标识（✨ Fix / ✨ Explain）：经 aiActionRegistry 派发给项目 agent（B1）。 */
export type AiQuickFixAction = 'fix' | 'explain';

/**
 * 菜单条目（VS Code 形态）：文案一律来自服务器响应，客户端不做语言推断。
 *
 * `disabledHint` 有值即不可点 —— 保留给通用菜单契约；当前分组只产出可执行项
 * （`source.*` / command-only 动作不铺进菜单）。
 */
export interface QuickFixMenuItem {
  title: string;
  /** 右侧次要信息（服务器名）。 */
  hint?: string;
  /** 置灰原因；有值即不可点。 */
  disabledHint?: string;
  /** 服务器声明的首选（LSP `CodeAction.isPreferred`）—— 由服务器决定，客户端不猜。 */
  preferred?: boolean;
  /**
   * AI 动作标记；有值时不走服务器 `edit`，经 `aiActionRegistry` 派发
   * （渲染端据此换 sparkle 图标，点击/Enter 走 AI 派发路径）。
   */
  ai?: AiQuickFixAction;
}

/** 一个分组（当前恒为单个 Quick Fix 组；组头保留给通用菜单契约，渲染端不显示）。 */
export interface QuickFixMenuSection {
  header: string;
  items: QuickFixMenuItem[];
}

/**
 * 拉取某个诊断范围的 codeAction。
 *
 * `context.diagnostics` **原样带上**（含 `data`）—— 诊断是原始 JSON 透传到前端的
 * （后端 `session/notify.rs` 不解析），部分服务器靠 `data` 匹配 quickfix。
 *
 * @returns 动作数组；服务端返回 null / 请求失败一律降级为 `[]`（诊断行只是没有灯泡）。
 */
export async function requestCodeActions(
  projectPath: string,
  languageId: string,
  uri: string,
  range: LspRange,
  diagnostics: LspDiagnostic[],
): Promise<LspCodeAction[]> {
  try {
    const result = await lspRequest(projectPath, languageId, 'textDocument/codeAction', {
      textDocument: { uri },
      range,
      context: { diagnostics: diagnostics ?? [] },
    });
    if (Array.isArray(result)) return result as LspCodeAction[];
    return [];
  } catch (e) {
    console.warn('[LSP] textDocument/codeAction failed:', e);
    return [];
  }
}

/**
 * 按 VS Code 形态平铺：只列**可直接应用**的修复（带 `edit`），且不含 `source.*`
 * 动作 —— 后者是文件级命令，不是"这个诊断的修复动作"，铺进来会淹没真正的 quickfix。
 *
 * 服务器给出的 command-only 动作（需 `workspace/executeCommand`）同样不列：
 * VS Code 的 quickfix 列表只呈现可用动作，不做"置灰声明"。
 *
 * 首选由服务器声明（`isPreferred`）：组内**首选排前**，客户端不自行推断哪个更该选。
 * AI 动作（✨ Fix / ✨ Explain）固定在列表末尾（sparkle 区分来源），服务器零动作时
 * 也提供 —— B1 形态下 agent 自己修，不依赖服务器 quickfix。
 * 面板行内菜单与编辑器内菜单共用本函数 —— 两端结构不允许各自漂移。
 */
export function groupQuickFixActions(actions: LspCodeAction[]): QuickFixMenuSection[] {
  const quickFix: QuickFixMenuItem[] = [];
  for (const action of actions) {
    if (!action.edit) continue;
    if (action.kind?.startsWith('source.')) continue;
    quickFix.push({ title: action.title, preferred: action.isPreferred === true });
  }

  // 首选排前（稳定的：只有 preferred 与其它交换相对次序）
  const preferredFirst = (items: QuickFixMenuItem[]) => [
    ...items.filter((item) => item.preferred),
    ...items.filter((item) => !item.preferred),
  ];

  return [{ header: 'Quick Fix', items: [...preferredFirst(quickFix), ...AI_ITEMS] }];
}

/** AI 动作（固定两顶：与 VS Code Copilot 的 quickfix 追加项一致）。 */
const AI_ITEMS: QuickFixMenuItem[] = [
  { title: 'Fix', ai: 'fix' },
  { title: 'Explain', ai: 'explain' },
];

/**
 * 派发一个诊断的 AI 动作（B1：agent 自己通过工具改文件，宿主只传上下文）。
 *
 * @returns 是否落地（编辑器页未打开 / 无 agent 接收 → false）。
 */
export function runAiQuickFixAction(
  uri: string,
  diagnostic: LspDiagnostic,
  ai: AiQuickFixAction,
): boolean {
  return runAiActionForUri(uri, {
    action: ai,
    // LSP range 0-based → 编辑器 1-based 行号
    startLine: diagnostic.range.start.line + 1,
    endLine: diagnostic.range.end.line + 1,
    diagnosticMessage: diagnostic.message,
  });
}

/**
 * 应用一个 codeAction 的 `edit`。
 *
 * 视图解析由调用方注入（默认走编辑器注册表）：lsp 域不直接依赖 editor 具体实现，
 * 测试传桩即可覆盖"未打开 / 已打开"两条分支。
 *
 * @returns 是否落地（没有打开的编辑器页 → false，见 `lspWorkspaceEdit` 的边界约定）。
 */
export function applyCodeAction(
  uri: string,
  action: LspCodeAction,
  resolveView: EditorViewResolver = resolveEditorViewFromUri,
): boolean {
  if (!action?.edit) {
    console.warn('[LSP] codeAction skipped: no edit (command-only actions are out of scope)');
    return false;
  }
  return applyWorkspaceEdit(action.edit, uri, resolveView);
}
