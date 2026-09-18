import { useCallback, useRef, useState } from 'react';

import { openProjectFile } from '@/features/quick-open';
import { cn } from '@/lib/utils';
import { ListX, X } from '@/shared/components/icons';
import { useProjectStore } from '@/shared/store/projectStore';
import { Island } from '@/ui/Island';

import { fromFileUri } from '../api/languageMap';
import { useLspStore } from '../store/lspStore';
import type { LspDiagnostic } from '../types';

import { DiagnosticsPanel } from './DiagnosticsPanel';

/**
 * Problems 底部固定面板（挂载于 app/panels/registry.ts，与 task-console/debug 同类）。
 *
 * 可见性由 lspStore.problemsPanelOpen 驱动（ProblemsItem 计数入口开关）；
 * 数据经 DiagnosticsPanel 直读 lspStore 诊断切片（D3 单写点），面板不持有诊断状态。
 */
const PANEL_H_KEY = 'neeko.problems.panelHeight';
const PANEL_H_DEFAULT = 220;
const PANEL_H_MIN = 120;
const PANEL_H_MAX_RATIO = 0.7;

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(PANEL_H_KEY);
    if (!raw) return PANEL_H_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? n : PANEL_H_DEFAULT;
  } catch {
    return PANEL_H_DEFAULT;
  }
}

function ProblemsPanel() {
  const panelOpen = useLspStore((s) => s.problemsPanelOpen);
  const setPanelOpen = useLspStore((s) => s.setProblemsPanelOpen);
  const activeProject = useProjectStore((s) => s.activeProject);
  const projectPath = activeProject?.path ?? '';
  const projectId = activeProject?.id ?? '';

  const latestH = useRef(PANEL_H_DEFAULT);
  const [panelHeight, setPanelHeight] = useState(readStoredHeight);

  /** 点击诊断行 → 打开目标文件并定位（复用 quick-open 通道；LSP 行 0-based → 1-based）。 */
  const handleJump = useCallback(
    (uri: string, diagnostic: LspDiagnostic) => {
      if (!activeProject) return;
      // 失败必须可见（读取被拒/路径解析失败曾静默吞掉，用户侧表现即「点了没反应」）。
      openProjectFile({
        projectId,
        filePath: fromFileUri(uri),
        line: diagnostic.range.start.line + 1,
        column: diagnostic.range.start.character,
      }).catch((err: unknown) => {
        console.error('[ProblemsPanel] jump to diagnostic failed:', fromFileUri(uri), err);
      });
    },
    [activeProject, projectId],
  );

  /** 顶缘拖拽调高（对齐 TaskConsolePanel 的 localStorage 持久化模式）。 */
  const startPanelResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = panelHeight;
      const onMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        const maxH = Math.floor(window.innerHeight * PANEL_H_MAX_RATIO);
        const next = Math.min(maxH, Math.max(PANEL_H_MIN, startH + delta));
        latestH.current = next;
        setPanelHeight(next);
      };
      const onUp = () => {
        try {
          localStorage.setItem(PANEL_H_KEY, String(latestH.current));
        } catch {
          /* ignore */
        }
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [panelHeight],
  );

  if (!panelOpen) return null;

  return (
    <div className="shrink-0 mx-11 px-px pb-0.5" data-testid="problems-panel">
      <Island className="relative" style={{ height: panelHeight }}>
        {/* 顶缘拖拽把手 */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className="absolute top-0 left-0 right-0 h-3 z-20 cursor-row-resize group"
          onMouseDown={startPanelResize}
          title="Drag to resize problems panel"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize problems panel"
        >
          <div className="absolute left-0 right-0 top-0 h-1 bg-transparent group-hover:bg-accent-blue/50 group-active:bg-accent-blue/60 transition-colors rounded-t-lg" />
          <div className="absolute left-1/2 top-1 -translate-x-1/2 w-8 h-[3px] rounded-full bg-border/80 group-hover:bg-accent-blue/70 group-active:bg-accent-blue transition-colors" />
        </div>

        {/* 头部：标题 + 关闭 */}
        <div className="flex items-center border-b border-border shrink-0 bg-bg-secondary h-8 rounded-t-lg gap-1 pr-1">
          <div className="inline-flex items-center gap-1.5 shrink-0 px-2.5">
            <ListX size={13} className="text-text-secondary shrink-0" />
            <span className="text-[var(--font-size)] font-medium text-text-primary">Problems</span>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            className={cn(
              'shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer',
            )}
            title="Hide problems"
            onClick={() => setPanelOpen(false)}
            data-testid="problems-panel-close"
          >
            <X size={14} />
          </button>
        </div>

        {/* 诊断列表（无活跃项目时 projectPath 为空 → 组件自身空态） */}
        <DiagnosticsPanel projectPath={projectPath} onJumpToDiagnostic={handleJump} />
      </Island>
    </div>
  );
}

export default ProblemsPanel;
