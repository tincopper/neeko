import { useLspStore } from '@/features/lsp/store/lspStore';
import { cn } from '@/lib/utils';
import { TriangleAlert, X } from '@/shared/components/icons';
import { useProjectStore } from '@/shared/store/projectStore';

/**
 * 右簇：诊断计数入口（Problems 面板开关）。
 *
 * 数据 = lspStore 诊断切片（D3 单写点，design.md「仅计数 = status-bar」侧通道）：
 * 仅统计 error / warning 两档（info/hint 不入徽标），点击开关 Problems 底部面板。
 */
export function ProblemsItem() {
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const activeProjectPath = useProjectStore((s) => s.activeProject?.path ?? '');
  const byUri = useLspStore((s) => s.diagnosticsByProject[activeProjectPath]);
  const panelOpen = useLspStore((s) => s.problemsPanelOpen);
  const toggleProblemsPanel = useLspStore((s) => s.toggleProblemsPanel);

  if (!activeProjectId) return null;

  let errors = 0;
  let warnings = 0;
  for (const diagnostics of Object.values(byUri ?? {})) {
    for (const d of diagnostics) {
      if (d.severity === 1) errors += 1;
      else if (d.severity === 2) warnings += 1;
    }
  }

  return (
    <button
      type="button"
      className={cn(
        'relative flex items-center gap-1.5 hover:text-text-primary cursor-pointer',
        panelOpen ? 'text-text-primary' : '',
      )}
      title={panelOpen ? 'Hide problems' : `Problems · ${errors} errors, ${warnings} warnings`}
      onClick={() => toggleProblemsPanel()}
      data-testid="problems-item"
    >
      <span className="relative inline-flex items-center gap-1.5">
        <X size={12} className="shrink-0" />
        <span>{errors}</span>
        <TriangleAlert size={12} className="shrink-0" />
        <span>{warnings}</span>
      </span>
    </button>
  );
}
