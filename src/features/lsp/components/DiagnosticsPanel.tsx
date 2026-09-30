import { useCallback, useMemo, useState } from 'react';

import { useLspStore } from '../store/lspStore';
import type { LspDiagnostic } from '../types';
import { orderDiagnosticFileGroups } from '../utils/diagnosticGroups';

import { DiagnosticGroup } from './DiagnosticGroup';

/**
 * 文件组数超过该阈值时默认折叠（P2：大项目首屏不渲染全部行）。
 *
 * **刻意不做设置项（YAGNI）**：它是**展示策略**——「首屏渲染多少行」的启发式，不是用户语义上
 * 可配置的事实。全局状态里既没有诊断规模的先验，也没有证据表明有人需要调它；做成设置要同时动
 * settings 类型 + 配置持久化 + 面板控件三处，收益只是「用户可调折叠阈值」。导出是为了让测试的
 * 夹具从同一个值派生（不再各写一个字面量 20）。
 */
export const COLLAPSED_GROUP_THRESHOLD = 20;

interface DiagnosticsPanelProps {
  /** 项目根路径（lspStore 诊断切片键，D3 单写点：数据直采 lsp-diagnostics 事件）。 */
  projectPath: string;
  /**
   * 点击诊断行回调：携带 LS 原始 uri 与诊断（行号 0-based，由消费方换算
   * 编辑器 1-based 行号后跳转）。
   */
  onJumpToDiagnostic?: (uri: string, diagnostic: LspDiagnostic) => void;
}

/**
 * Problems 诊断列表（VS Code Problems 视觉契约）：
 * 文件组头 = 折叠 chevron + 文件类型图标 + 文件名（主色）+ 父目录（暗色）+ 计数徽章；
 * 诊断行 = 缩进参考线 + severity 图标 + 消息 + source（暗）+ code（括号暗蓝，有才渲染）
 * + [Ln X, Col Y]（暗，LSP 0-based → 显示 +1）。行点击跳转由消费方（ProblemsPanel）承接。
 * 折叠状态 = 组件内存（useState，默认展开），不持久化。
 *
 * 职责边界：本组件只做「有序文件分组列表 + 折叠状态 + 回调稳定化」；单个分组的排序与渲染
 * （增量边界）在 `DiagnosticGroup`，组头在 `DiagnosticGroupHeader`，纯投影在
 * `utils/diagnosticGroups`。
 */
export function DiagnosticsPanel({ projectPath, onJumpToDiagnostic }: DiagnosticsPanelProps) {
  const byUri = useLspStore((s) => s.diagnosticsByProject[projectPath]);
  // 只算「顺序 + 标签」这一层；组内排序/渲染由 DiagnosticGroup 按 uri 增量承接。
  const groups = useMemo(() => orderDiagnosticFileGroups(byUri, projectPath), [byUri, projectPath]);
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

  // 稳定回调：作为 `DiagnosticGroup` / `DiagnosticRow` 的 memo prop，引用不变时无关 publish
  // 不触发重渲染。
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
        {groups.map((group) => (
          <DiagnosticGroup
            key={group.uri}
            uri={group.uri}
            label={group.label}
            diagnostics={group.diagnostics}
            projectPath={projectPath}
            isCollapsed={collapsed[group.uri] ?? defaultCollapsed}
            onToggle={toggleCollapsed}
            onJump={onJump}
          />
        ))}
      </div>
    </div>
  );
}
