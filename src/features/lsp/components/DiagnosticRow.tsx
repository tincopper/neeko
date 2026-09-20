import { memo, useCallback } from 'react';

import { openInDefaultBrowser } from '@/features/browser/api/browserApi';

import type { LspDiagnostic } from '../types';

import { DiagnosticQuickFix } from './DiagnosticQuickFix';
import { SeverityIcon, severityColorClass } from './SeverityIcon';

interface DiagnosticRowProps {
  /** 诊断所属文件 uri（group.uri）。 */
  uri: string;
  projectPath: string;
  /** 组内共享的语言 ID（按组算一次，P2 懒渲染）；null = 识别不出 → 灯泡不显示。 */
  languageId: string | null;
  diagnostic: LspDiagnostic;
  /** 行点击跳转；父组件经 useCallback 稳定引用，memo 才生效。 */
  onJump?: (uri: string, diagnostic: LspDiagnostic) => void;
}

/**
 * 单条诊断行（VS Code Problems 视觉契约 2）+ 行内 quickfix 灯泡。
 *
 * `React.memo`（P3）：props 全为稳定引用（诊断对象引用 / uri / languageId /
 * 稳定 onJump）时，无关 uri 的 publish 不触发本行重渲染 —— 千行级面板的渲染
 * 成本从 O(总行数) 收敛到 O(本次变更行数)。
 *
 * 外层 div 只为提供 `group`（灯泡按 group-hover 显形）。行与灯泡都是 button，
 * 嵌套 button 是非法 DOM —— 必须做成兄弟而不是父子。
 */
export const DiagnosticRow = memo(function DiagnosticRow({
  uri,
  projectPath,
  languageId,
  diagnostic,
  onJump,
}: DiagnosticRowProps) {
  const jump = useCallback(() => onJump?.(uri, diagnostic), [uri, diagnostic, onJump]);

  return (
    <div className="group w-full flex items-center gap-2 pl-2 pr-2 py-1 text-xs hover:bg-bg-hover transition-colors">
      <button
        type="button"
        data-testid="diagnostic-row"
        onClick={jump}
        className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
      >
        <span
          data-testid="diagnostic-row-icon"
          className={`shrink-0 ${severityColorClass(diagnostic.severity)}`}
        >
          <SeverityIcon severity={diagnostic.severity} />
        </span>
        <span className="min-w-0 flex-1 truncate text-text-primary">{diagnostic.message}</span>
        {diagnostic.source && <span className="shrink-0 text-text-muted">{diagnostic.source}</span>}
        {diagnostic.code != null &&
          // 有 codeDescription.target → 真链接（VS Code 同款：打开诊断文档，
          // 系统默认浏览器）；否则静态文本。stopPropagation 防止触发行跳转。
          (diagnostic.codeDescription?.href ? (
            <a
              href={diagnostic.codeDescription.href}
              data-testid="diagnostic-code-link"
              className="shrink-0 text-blue-400/80 underline underline-offset-2 hover:text-blue-300"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void openInDefaultBrowser(diagnostic.codeDescription!.href);
              }}
            >
              ({diagnostic.code})
            </a>
          ) : (
            <span className="shrink-0 text-blue-400/80">({diagnostic.code})</span>
          ))}
        <span className="shrink-0 text-text-muted">
          [Ln {diagnostic.range.start.line + 1}, Col {diagnostic.range.start.character + 1}]
        </span>
      </button>
      <DiagnosticQuickFix
        projectPath={projectPath}
        languageId={languageId}
        uri={uri}
        diagnostic={diagnostic}
      />
    </div>
  );
});
