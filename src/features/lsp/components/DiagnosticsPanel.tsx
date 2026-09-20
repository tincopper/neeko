import { useCallback, useMemo, useState } from 'react';

import { ChevronRight } from '@/shared/components/icons';
import { fileIconSrc } from '@/shared/utils/fileIcons';

import { fromFileUri, getLspLanguageId } from '../api/languageMap';
import { useLspStore } from '../store/lspStore';
import type { LspDiagnostic } from '../types';

import { DiagnosticRow } from './DiagnosticRow';

/** 文件组数超过该阈值时默认折叠（P2：大项目首屏不渲染全部行）。 */
const COLLAPSED_GROUP_THRESHOLD = 20;

interface DiagnosticsPanelProps {
  /** 项目根路径（lspStore 诊断切片键，D3 单写点：数据直采 lsp-diagnostics 事件）。 */
  projectPath: string;
  /**
   * 点击诊断行回调：携带 LS 原始 uri 与诊断（行号 0-based，由消费方换算
   * 编辑器 1-based 行号后跳转）。
   */
  onJumpToDiagnostic?: (uri: string, diagnostic: LspDiagnostic) => void;
}

/** 单文件的诊断分组（Problems 面板按文件分组渲染）。 */
interface DiagnosticFileGroup {
  uri: string;
  /** 展示路径：file:// 解码；项目内相对化，项目外/非文件 uri 原样。 */
  label: string;
  diagnostics: LspDiagnostic[];
}

/** severity → 排序权重（errors 最先，null 与 hint 殿后）。 */
function severityRank(severity: number | null): number {
  if (severity === null || severity === undefined) return 3;
  return Math.min(4, Math.max(1, severity)) - 1;
}

/** file:// uri → 展示路径；项目内相对化（jdt:// 等非文件 uri 原样返回）。 */
function fileLabel(uri: string, projectPath: string): string {
  const path = fromFileUri(uri);
  if (projectPath && path.startsWith(projectPath)) {
    const relative = path.slice(projectPath.length);
    return relative.startsWith('/') ? relative.slice(1) : relative;
  }
  return path;
}

/** Record<uri, diagnostics> → 按文件分组并排序（文件名字母序；组内 severity → 行号）。 */
function buildGroups(
  byUri: Record<string, LspDiagnostic[]>,
  projectPath: string,
): DiagnosticFileGroup[] {
  const groups: DiagnosticFileGroup[] = [];
  for (const [uri, diagnostics] of Object.entries(byUri)) {
    // 空 arrays（清空语义）不渲染分组
    if (!Array.isArray(diagnostics) || diagnostics.length === 0) continue;
    groups.push({
      uri,
      label: fileLabel(uri, projectPath),
      diagnostics: [...diagnostics].sort((a, b) => {
        const bySeverity = severityRank(a.severity) - severityRank(b.severity);
        if (bySeverity !== 0) return bySeverity;
        const byLine = a.range.start.line - b.range.start.line;
        if (byLine !== 0) return byLine;
        return a.range.start.character - b.range.start.character;
      }),
    });
  }
  groups.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return groups;
}

/** 相对路径 → basename / dirname（组头：文件名主色 + 父目录暗色；根级文件无 dirname）。 */
function splitLabel(label: string): { name: string; dir: string } {
  const idx = label.lastIndexOf('/');
  if (idx < 0) return { name: label, dir: '' };
  return { name: label.slice(idx + 1), dir: label.slice(0, idx) };
}

/**
 * Problems 诊断列表（VS Code Problems 视觉契约）：
 * 文件组头 = 折叠 chevron + 文件类型图标 + 文件名（主色）+ 父目录（暗色）+ 计数徽章；
 * 诊断行 = 缩进参考线 + severity 图标 + 消息 + source（暗）+ code（括号暗蓝，有才渲染）
 * + [Ln X, Col Y]（暗，LSP 0-based → 显示 +1）。行点击跳转由消费方（ProblemsPanel）承接。
 * 折叠状态 = 组件内存（useState，默认展开），不持久化。
 */
export function DiagnosticsPanel({ projectPath, onJumpToDiagnostic }: DiagnosticsPanelProps) {
  const byUri = useLspStore((s) => s.diagnosticsByProject[projectPath]);
  const groups = useMemo(() => buildGroups(byUri ?? {}, projectPath), [byUri, projectPath]);
  // 折叠状态按 uri 键控（显式点击覆盖）；未显式设置时按组数阈值默认折叠（P2）。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const defaultCollapsed = groups.length > COLLAPSED_GROUP_THRESHOLD;

  const toggleCollapsed = useCallback(
    (uri: string) => {
      // 基于当前展开态翻转：默认折叠（defaultCollapsed=true）时，第一次点击必须展开
      // （prev[uri] 为 undefined，须按 defaultCollapsed 计算而非 !undefined=true）。
      setCollapsed((prev) => ({ ...prev, [uri]: !(prev[uri] ?? defaultCollapsed) }));
    },
    [defaultCollapsed],
  );

  // 稳定回调：作为行 memo 的 prop，引用不变时无关 publish 不触发行重渲染（P3）。
  const onJump = useCallback(
    (uri: string, diagnostic: LspDiagnostic) => onJumpToDiagnostic?.(uri, diagnostic),
    [onJumpToDiagnostic],
  );

  if (groups.length === 0) {
    return <div className="p-3 text-xs text-text-secondary">No diagnostics</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {groups.map((group) => {
          const { name, dir } = splitLabel(group.label);
          const isCollapsed = collapsed[group.uri] ?? defaultCollapsed;
          // P2：组内共享语言 ID 按组算一次，不再每行重算。
          const languageId = getLspLanguageId(fromFileUri(group.uri));
          return (
            <div key={group.uri} data-testid={`diagnostic-file-group-${group.label}`}>
              {/* 文件组头：点击折叠/展开 */}
              <button
                type="button"
                data-testid={`diagnostics-group-header-${group.label}`}
                onClick={() => toggleCollapsed(group.uri)}
                aria-expanded={!isCollapsed}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-bg-hover transition-colors text-left cursor-pointer"
              >
                <ChevronRight
                  size={12}
                  className={`shrink-0 text-text-muted transition-transform${
                    isCollapsed ? '' : ' rotate-90'
                  }`}
                />
                <img src={fileIconSrc(name)} alt="" className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium text-text-primary truncate">{name}</span>
                {dir && <span className="text-text-muted truncate">{dir}</span>}
                <span
                  data-testid="diagnostic-group-count"
                  className="ml-auto shrink-0 rounded-full bg-bg-hover px-1.5 text-[10px] leading-4 py-px text-text-muted"
                >
                  {group.diagnostics.length}
                </span>
              </button>
              {/* 折叠后行不渲染（P2 懒渲染：折叠组零行，大项目首屏只渲染组头） */}
              {!isCollapsed && (
                <div className="ml-6 border-l border-border/60">
                  {group.diagnostics.map((d) => (
                    <DiagnosticRow
                      key={`${d.message}-${d.range.start.line}-${d.range.start.character}-${
                        d.severity ?? 'none'
                      }`}
                      uri={group.uri}
                      projectPath={projectPath}
                      languageId={languageId}
                      diagnostic={d}
                      onJump={onJump}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
