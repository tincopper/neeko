import { useShallow } from 'zustand/shallow';

import { useLspStore, type LspSessionState } from '@/shared/store/lspStore';
import { useProjectStore } from '@/shared/store/projectStore';

import { LspStatusSection, serverName } from '../LspStatusSection';

/**
 * 左簇 lsp 槽位：优先级互斥 install-progress > sessions > profile。
 * 单组件内直写优先级（plain if 链，hooks 全部无条件在前），不跨组件认领——
 * 仅此一组互斥，不值得一套认领基建（YAGNI；react-hooks/immutability 亦禁
 * render 期跨组件可变认领表）。原 leftContent 三分支 + LspStatusSection。
 */
export function LspSlotItem() {
  const activeProjectPath = useProjectStore((s) => s.activeProject?.path);
  const installProgress = useLspStore((s) => s.installProgress);
  const projectProfile = useLspStore((s) =>
    activeProjectPath ? (s.profiles[activeProjectPath] ?? null) : null,
  );
  // Use shallow comparison to avoid re-render loops from new {} references.
  // Filter out stopped sessions — they should not appear in the status bar.
  const sessionEntries = useLspStore(
    useShallow((s) => {
      if (!activeProjectPath) return [] as LspSessionState[];
      const projectSessions = s.sessions[activeProjectPath];
      if (!projectSessions) return [] as LspSessionState[];
      return Object.values(projectSessions).filter((se) => se.status !== 'stopped');
    }),
  );

  if (installProgress) {
    const { phase, language_id, message } = installProgress;
    const fromProfile = projectProfile?.candidates?.find((c) => c.languageId === language_id);
    const label = serverName(language_id, fromProfile?.serverName);
    if (phase === 'installing') {
      return (
        <span className="flex items-center gap-1.5 text-text-muted">
          <span className="lsp-spinner" />
          <span>
            Installing {label}
            <span className="lsp-dot">.</span>
            <span className="lsp-dot">.</span>
            <span className="lsp-dot">.</span>
          </span>
        </span>
      );
    }
    if (phase === 'done') {
      return <span className="text-status-idle">{label}</span>;
    }
    return (
      <span className="text-text-muted" title={message}>
        {label} install failed
      </span>
    );
  }

  if (sessionEntries.length > 0 && activeProjectPath !== undefined) {
    return <LspStatusSection />;
  }

  // Profile detected but no server running yet (autoStart=onFirstFile) — non-interactive in v1
  const primary = projectProfile?.primary;
  if (primary) {
    const label = serverName(primary.languageId, primary.serverName);
    const markers = primary.markers.length > 0 ? primary.markers.join(', ') : 'project override';
    return (
      <span
        className="flex items-center gap-1.5 text-text-muted"
        title={`${primary.languageId} (${markers}). Open a matching file to start ${label}.`}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-text-muted" />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return null;
}
