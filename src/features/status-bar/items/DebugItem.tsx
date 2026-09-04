import { useDebugStore } from '@/features/debug/store/debugStore';
import { cn } from '@/lib/utils';
import { Bug } from '@/shared/components/icons';
import { useProjectStore } from '@/shared/store/projectStore';

/** 右簇：调试面板开关（含会话状态徽标）。 */
export function DebugItem() {
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const debugSession = useDebugStore((s) => s.session);
  const debugPanelOpen = useDebugStore((s) => s.panelOpen);
  const toggleDebugPanel = useDebugStore((s) => s.togglePanel);

  if (!activeProjectId) return null;

  return (
    <button
      type="button"
      className={cn(
        'relative flex items-center gap-1.5 hover:text-text-primary cursor-pointer',
        debugPanelOpen ? 'text-text-primary' : '',
      )}
      title={
        debugSession
          ? `Debug · ${debugSession.status}${debugSession.configName ? ` · ${debugSession.configName}` : ''}`
          : debugPanelOpen
            ? 'Hide debug panel'
            : 'Show debug panel'
      }
      onClick={() => toggleDebugPanel()}
    >
      <span className="relative inline-flex">
        <Bug size={12} className="shrink-0" />
        {debugSession ? (
          <span
            className={cn(
              'absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full',
              debugSession.status === 'stopped'
                ? 'bg-accent-yellow'
                : debugSession.status === 'running' || debugSession.status === 'starting'
                  ? 'bg-accent-green animate-pulse'
                  : 'bg-text-muted',
            )}
          />
        ) : null}
      </span>
      <span>Debug</span>
    </button>
  );
}
