import type { EditorView } from '@codemirror/view';

import { offsetToLspPosition } from '@/shared/utils/lspPosition';
import { IS_MACOS } from '@/shared/utils/platform';

import {
  applyCodeAction,
  groupQuickFixActions,
  requestCodeActions,
  runAiQuickFixAction,
} from '../api/codeAction';
import { useLspStore } from '../store/lspStore';
import type { LspDiagnostic } from '../types';

import { showQuickFixMenu } from './quickFixMenuRender';

/**
 * 编辑器内 quickfix 的动作**派发**层：诊断上下文、光标处诊断定位、
 * 动作派发（服务器首选 / AI Fix / 问题查看）与弹出编排（`openQuickFixAt`）。
 *
 * 从 `lspQuickFixMenu.ts` 拆出（F7a）：本层单向依赖渲染层
 * （`./quickFixMenuRender` 的 `showQuickFixMenu` + 菜单类型），渲染层反向零依赖。
 *
 * 诊断取自 **lspStore**（原始 LSP 诊断，保留 `data`）而不是 CM6 lint state —— 后者经
 * `@codemirror/lsp-client` 映射后只剩 message/severity/from/to，`data` 已丢失，而部分
 * 服务器要靠它匹配 quickfix。store 同时是诊断的单一事实源（不变量 I1）。
 *
 * 上下文（projectPath / uri / languageId）由装配方注入：uri 必须与发给服务器的
 * didOpen 完全一致（见 `useFileEditorLsp`），此处不自行推导。
 */
export interface LspQuickFixContext {
  projectPath: string | null;
  /** 文档 uri（与发给服务器的 didOpen 一致）；拿不到时为 null —— 此时不接管按键。 */
  uri: string | null;
  /** 异步就绪（LSP 会话握手后才有值），故按 ref 语义在调用时读取。 */
  getLanguageId: () => string | null;
}

/** 光标处最贴合的诊断：包含光标位置者中跨度最小的一条（重叠时取最具体的一个）。 */
export function diagnosticAtPosition(
  diagnostics: LspDiagnostic[] | undefined,
  position: { line: number; character: number },
): LspDiagnostic | null {
  if (!Array.isArray(diagnostics)) return null;
  const contains = (d: LspDiagnostic): boolean => {
    const { start, end } = d.range;
    const afterStart =
      position.line > start.line ||
      (position.line === start.line && position.character >= start.character);
    const beforeEnd =
      position.line < end.line ||
      (position.line === end.line && position.character <= end.character);
    return afterStart && beforeEnd;
  };
  const span = (d: LspDiagnostic): number =>
    (d.range.end.line - d.range.start.line) * 10_000 +
    (d.range.end.character - d.range.start.character);

  const hits = diagnostics.filter(contains);
  if (hits.length === 0) return null;
  return hits.reduce((best, d) => (span(d) < span(best) ? d : best));
}

/**
 * 快捷键提示文案（VS Code 同构：mac 用符号、其它平台用 Alt/Ctrl，不硬编码 ⌥）。
 */
export function shortcutHint(key: 'fix' | 'quickFix' | 'viewProblem'): string {
  if (key === 'viewProblem') return 'F2';
  if (key === 'quickFix') return IS_MACOS ? '⌥Enter' : 'Alt+Enter';
  // `fix` = AI Fix（✨，Mod-I）；服务器首选仍是 Mod-.（见 applyPreferredFixAt），不占提示位
  return IS_MACOS ? '⌘I' : 'Ctrl+I';
}

/** `View Problem`：展开 Problems 面板（该诊断即在其分组下）。 */
export function viewProblemAt(ctx: LspQuickFixContext): void {
  void ctx;
  useLspStore.setState({ problemsPanelOpen: true });
}

/**
 * `Fix`：直接应用服务器声明的首选动作；服务器没声明首选时退回展开候选菜单
 * （VS Code 此时不显示该动作，我们无法预知，故用"退化为菜单"这一等价可用的行为）。
 */
export function applyPreferredFixAt(
  view: EditorView,
  ctx: LspQuickFixContext,
  pos = view.state.selection.main.head,
): boolean {
  const languageId = ctx.getLanguageId();
  if (!ctx.projectPath || !ctx.uri || !languageId) return false;
  const uri = ctx.uri;
  const line = view.state.doc.lineAt(pos);
  const byUri = useLspStore.getState().diagnosticsByProject[ctx.projectPath];
  const diagnostic = diagnosticAtPosition(
    byUri?.[uri],
    offsetToLspPosition(pos, line.number, line.from),
  );
  if (!diagnostic) return false;

  void requestCodeActions(ctx.projectPath, languageId, uri, diagnostic.range, [diagnostic])
    .then((actions) => {
      const preferred = actions.find((action) => action.isPreferred && action.edit);
      if (preferred) {
        applyCodeAction(uri, preferred);
        return;
      }
      openQuickFixAt(view, ctx, pos);
    })
    .catch(() => openQuickFixAt(view, ctx, pos));
  return true;
}

/**
 * `✨ Fix`（Mod-I）：把诊断上下文交给项目 agent（B1 —— agent 自己通过工具改文件，
 * 宿主不解析补丁）。与 `Mod-.`（服务器首选 fix）并存，互不抢占。
 */
export function runAiFixAt(
  view: EditorView,
  ctx: LspQuickFixContext,
  pos = view.state.selection.main.head,
): boolean {
  if (!ctx.projectPath || !ctx.uri) return false;
  const line = view.state.doc.lineAt(pos);
  const byUri = useLspStore.getState().diagnosticsByProject[ctx.projectPath];
  const diagnostic = diagnosticAtPosition(
    byUri?.[ctx.uri],
    offsetToLspPosition(pos, line.number, line.from),
  );
  if (!diagnostic) return false;
  return runAiQuickFixAction(ctx.uri, diagnostic, 'fix');
}

/** 光标（或指定位置）处打开 quickfix；返回是否"接管了这次触发"。 */
export function openQuickFixAt(
  view: EditorView,
  ctx: LspQuickFixContext,
  pos = view.state.selection.main.head,
): boolean {
  const languageId = ctx.getLanguageId();
  if (!ctx.projectPath || !ctx.uri || !languageId) return false;

  const line = view.state.doc.lineAt(pos);
  const position = offsetToLspPosition(pos, line.number, line.from);
  const uri = ctx.uri;
  const byUri = useLspStore.getState().diagnosticsByProject[ctx.projectPath];
  const diagnostic = diagnosticAtPosition(byUri?.[uri], position);
  if (!diagnostic) return false;

  // 锚点 = 光标所在的 DOM 坐标（找不到就退回编辑器左上角）
  const coords = view.coordsAtPos(pos) ?? view.dom.getBoundingClientRect();
  const anchor = { getBoundingClientRect: () => coords as DOMRect };

  const close = showQuickFixMenu(anchor, [], { loading: true });

  void requestCodeActions(ctx.projectPath, languageId, uri, diagnostic.range, [diagnostic])
    .then((actions) => {
      close();
      // 平铺单列（VS Code 形态）：服务器动作 + 末尾 ✨ Fix / ✨ Explain
      const sections = groupQuickFixActions(actions).map((section) => ({
        ...section,
        items: section.items.map((item) => {
          const aiKind = item.ai;
          return item.disabledHint
            ? item
            : {
                ...item,
                onPick: aiKind
                  ? // AI 动作（✨ Fix / ✨ Explain）：派发注册表，不经服务器 edit
                    () => {
                      runAiQuickFixAction(uri, diagnostic, aiKind);
                    }
                  : () => {
                      const action = actions.find((candidate) => candidate.title === item.title);
                      if (action) applyCodeAction(uri, action);
                    },
              };
        }),
      }));
      showQuickFixMenu(anchor, sections);
    })
    .catch(() => close());

  return true;
}
