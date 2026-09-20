import type { Extension } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';

import { openInDefaultBrowser } from '@/features/browser/api/browserApi';
import { lspPositionToOffset, offsetToLspPosition } from '@/shared/utils/lspPosition';

import { diagnosticCodeBadge, diagnosticCodeTooltip } from '../components/diagnosticCode';
import { sparklesSvgMarkup } from '../components/QuickFixBulbIcon';
import { severityColorClass, severitySvgMarkup } from '../components/SeverityIcon';
import { useLspStore } from '../store/lspStore';
import type { LspDiagnostic } from '../types';

import {
  diagnosticAtPosition,
  openQuickFixAt,
  runAiFixAt,
  shortcutHint,
  viewProblemAt,
  type LspQuickFixContext,
} from './quickFixMenuActions';

/**
 * 编辑器内 quickfix 的 popup 层：诊断 hover 提示（VS Code 同构 —— 一行消息 +
 * 一行动作链接 View Problem / Quick Fix… / ✨ Fix）。**不内嵌 quickfix 菜单** ——
 * 菜单由 `Quick Fix…` 打开（见 `quickFixMenuActions.openQuickFixAt`，届时才拉 codeAction）。
 *
 * 消息行复用 Problems 面板的诊断行样式（`diagnosticSeverity` 单一事实源）：
 * 严重度图标 + 消息 + source（暗）+ (code)（蓝，有 codeDescription 时开诊断文档）。
 *
 * 外壳与内容分离：`dom` 是 CodeMirror tooltip 记录根节点，`body` 往里填动作行。
 */
export function createDiagnosticPopup(diagnostic: LspDiagnostic): {
  dom: HTMLElement;
  body: HTMLElement;
} {
  // 专属类：边框/底色/圆角/阴影由外层 .cm-tooltip 承载（lsp.css `:has` 规则），
  // 内层透明 —— 避免圆角处露出方形外壳的深色底（"四角黑色"）。
  const dom = document.createElement('div');
  dom.className = 'neeko-diagnostic-popup min-w-56 max-w-96';
  dom.setAttribute('data-testid', 'editor-diagnostic-popup');

  // 消息行：与 Problems 面板行同构（VS Code：错误内容以同样式呈现）
  const row = document.createElement('div');
  row.className = 'flex items-start gap-2 px-2.5 pt-2 pb-1 text-xs';
  // 数字 code 不占行尾，但原值留在 title（悬停可查：TS 2339 / JDT 内部 ID）
  const codeTooltip = diagnosticCodeTooltip(diagnostic);
  if (codeTooltip) row.title = codeTooltip;

  const icon = document.createElement('span');
  icon.className = `shrink-0 mt-px ${severityColorClass(diagnostic.severity)}`;
  icon.innerHTML = severitySvgMarkup(diagnostic.severity, 14);
  row.appendChild(icon);

  const message = document.createElement('span');
  // 换行而非截断：长消息完整展示（VS Code hover 不省略）
  message.className = 'min-w-0 flex-1 break-words text-text-primary';
  message.setAttribute('data-testid', 'editor-diagnostic-popup-message');
  message.textContent = diagnostic.message;
  row.appendChild(message);

  if (diagnostic.source) {
    const source = document.createElement('span');
    source.className = 'shrink-0 text-text-muted';
    source.textContent = diagnostic.source;
    row.appendChild(source);
  }

  const badge = diagnosticCodeBadge(diagnostic);
  if (badge) {
    // 有诊断文档 → 真链接（VS Code 同款：打开诊断文档，系统默认浏览器）
    if (badge.href) {
      const link = document.createElement('a');
      link.href = badge.href;
      link.className =
        'shrink-0 text-blue-400/80 underline underline-offset-2 hover:text-blue-300 cursor-pointer';
      link.textContent = `(${badge.label})`;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        void openInDefaultBrowser(badge.href!);
      });
      row.appendChild(link);
    } else {
      const code = document.createElement('span');
      code.className = 'shrink-0 text-blue-400/80';
      code.textContent = `(${badge.label})`;
      row.appendChild(code);
    }
  }

  dom.appendChild(row);

  const body = document.createElement('div');
  dom.appendChild(body);

  return { dom, body };
}

/** popup 底部：三个键位入口（VS Code 形态）。
 *
 * 入口作用于 **popup 自己的诊断**（hover pos），与动作行同源 —— 光标可以悬停在
 * 别处，按光标解析会把另一条诊断的上下文派发给 agent（或静默 no-op）。
 * 导出供单测：动作行布局（单行不换行）在 jsdom 里只有直接调本函数才能断言。
 */
export function appendShortcutRow(
  body: HTMLElement,
  ctx: LspQuickFixContext,
  view: EditorView,
  pos: number,
): void {
  const row = document.createElement('div');
  row.setAttribute('data-testid', 'editor-diagnostic-popup-actions');
  // 单行不换行（VS Code 动作行形态）
  row.className =
    'flex items-center gap-x-3 whitespace-nowrap px-2.5 py-1 text-[10.5px] text-[var(--text-muted)]';

  const entries: { label: string; icon?: string; run: () => void }[] = [
    { label: `View Problem (${shortcutHint('viewProblem')})`, run: () => viewProblemAt(ctx) },
    {
      label: `Quick Fix… (${shortcutHint('quickFix')})`,
      run: () => openQuickFixAt(view, ctx, pos),
    },
    {
      // AI 动作：lucide `Sparkles` 图标（与应用其他 AI 场景同一图标，不用 ✨ 字符）。
      // 图标缩到与 10.5px 文字匹配的 10px + 细描边，避免比文字还大。
      label: `Fix (${shortcutHint('fix')})`,
      icon: sparklesSvgMarkup(10, 1.75),
      run: () => runAiFixAt(view, ctx, pos),
    },
  ];
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    // flex + items-center 垂直居中对齐图标与文字；gap 拉开图标与文字间距
    button.className =
      'inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer';
    if (entry.icon) {
      const icon = document.createElement('span');
      icon.className = 'inline-flex shrink-0 text-[var(--accent-blue)]';
      icon.innerHTML = entry.icon;
      button.appendChild(icon);
    }
    button.appendChild(document.createTextNode(entry.label));
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', entry.run);
    row.appendChild(button);
  }
  body.appendChild(row);
}

/**
 * 编辑器内的诊断 hover 提示（自建，替换 `@codemirror/lint` 的内置 tooltip）。
 *
 * 为什么自建：内置 tooltip 只有「消息 + 一行按钮」，而我们要的是 VS Code 形态的
 * 「消息 + View Problem / Quick Fix… / ✨ Fix」动作行；内置 tooltip 的关闭开关只能
 * 经 `linter()` 传入（本仓禁止挂空 source 的 linter），故用
 * `patches/@codemirror__lint@6.9.5.patch` 承认"宿主接管"——见 `TOOLTIP_OWNER_CLASS`。
 *
 * 数据源：诊断取 lspStore（保留 `data`，与菜单同源）。菜单不在此处内嵌 ——
 * `Quick Fix…` 打开 picker（`openQuickFixAt`）时才拉 codeAction。
 */
export function diagnosticHoverTooltip(ctx: LspQuickFixContext): Extension {
  return hoverTooltip(
    (view, pos) => {
      const languageId = ctx.getLanguageId();
      if (!ctx.projectPath || !ctx.uri || !languageId) return null;
      const uri = ctx.uri;

      const byUri = useLspStore.getState().diagnosticsByProject[ctx.projectPath];
      const line = view.state.doc.lineAt(pos);
      const diagnostic = diagnosticAtPosition(
        byUri?.[uri],
        offsetToLspPosition(pos, line.number, line.from),
      );
      if (!diagnostic) return null;

      const end = lspPositionToOffset(view.state.doc, diagnostic.range.end) ?? pos;
      return {
        pos,
        end,
        above: true,
        create: () => {
          const { dom, body } = createDiagnosticPopup(diagnostic);
          // hover pos：动作链接作用于 **popup 自己的诊断**，不是光标处
          appendShortcutRow(body, ctx, view, pos);
          return { dom };
        },
      };
    },
    { hoverTime: 120 },
  );
}

/** 接管标记：`@codemirror/lint` 的补丁据此让出内置 tooltip。 */
export const TOOLTIP_OWNER_CLASS = 'neeko-lint-tooltip-owner';
