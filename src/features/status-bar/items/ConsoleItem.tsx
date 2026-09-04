import { cn } from '@/lib/utils';
import { Terminal } from '@/shared/components/icons';
import { useProjectStore } from '@/shared/store/projectStore';
import { useTaskStore } from '@/shared/store/taskStore';

/** 右簇：任务控制台开关（含运行中/失败徽标）。 */
export function ConsoleItem() {
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const consolePanelOpen = useTaskStore((s) => s.consolePanelOpen);
  const toggleConsolePanel = useTaskStore((s) => s.toggleConsolePanel);
  const consoleSessions = useTaskStore((s) => s.consoleSessions);
  const activeConsoleId = useTaskStore((s) => s.activeConsoleId);

  if (!activeProjectId) return null;

  const runningConsoleCount = consoleSessions.filter((s) => s.status === 'running').length;
  const activeConsole =
    consoleSessions.find((s) => s.id === activeConsoleId) ??
    consoleSessions.find((s) => s.status === 'running') ??
    null;

  return (
    <button
      type="button"
      className={cn(
        'relative flex items-center gap-1.5 hover:text-text-primary cursor-pointer',
        consolePanelOpen ? 'text-text-primary' : '',
      )}
      title={
        runningConsoleCount > 0
          ? `Console · ${activeConsole?.name ?? 'running'}`
          : consolePanelOpen
            ? 'Hide task console'
            : 'Show task console'
      }
      onClick={() => toggleConsolePanel()}
    >
      <span className="relative inline-flex">
        <Terminal size={12} className="shrink-0" />
        {runningConsoleCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
        ) : activeConsole?.status === 'failed' ? (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent-red" />
        ) : null}
      </span>
      <span>Console</span>
    </button>
  );
}
