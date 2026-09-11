import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/shallow';

import { lspCheckServerInstalled } from '@/features/lsp/api/lspApi';
import { useLspStore, type LspSessionState } from '@/features/lsp/store/lspStore';
import { useProjectStore } from '@/shared/store/projectStore';

import { serverName } from '../lspStatusFormat';
import { LspStatusSection } from '../LspStatusSection';

/**
 * 安装进度指示 + 日志查看：可点击展开/收起日志面板（向上弹出）。
 * 弹窗必须 portal 到 document.body（状态栏 h-4 且 z-index 层级复杂，非 portal
 * 必被裁剪/遮挡），定位用 getBoundingClientRect() 上弹公式 —— 对齐
 * LspStatusSection / PromptsStatusSection 范本。
 */
function InstallProgressLog({ log }: { log: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  if (!log) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
      });
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="lsp-install-log-toggle"
        title={open ? '收起安装日志' : '查看安装日志'}
        onClick={toggle}
      >
        日志
      </button>
      {open && panelStyle
        ? createPortal(
            <div
              className="lsp-install-log-panel"
              data-testid="lsp-install-log"
              role="region"
              aria-label="安装日志"
              style={panelStyle}
            >
              <pre>{log}</pre>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** 探测主语言服务器的安装态（command_exists 软检，不 spawn）；无项目/语言 → null。 */
function useServerInstalled(
  projectPath: string | undefined,
  languageId: string | undefined,
): boolean | null {
  const [state, setState] = useState<boolean | null>(null);
  useEffect(() => {
    if (!projectPath || !languageId) {
      return; // 无输入时上层不使用该值；切换语言由 deps 重新触发异步探测
    }
    let cancelled = false;
    lspCheckServerInstalled(projectPath, languageId)
      .then((ok) => {
        if (!cancelled) setState(ok);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, languageId]);
  return state;
}

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
  // Profile 分支的安装态探测：hooks 无条件在前（分支内不可再调用）。
  const primary = projectProfile?.primary;
  const primaryInstalled = useServerInstalled(activeProjectPath ?? undefined, primary?.languageId);

  if (installProgress) {
    const { phase, language_id, message, log } = installProgress;
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
          <InstallProgressLog log={log} />
        </span>
      );
    }
    if (phase === 'done') {
      return (
        <span className="flex items-center gap-1.5 text-status-idle">
          <span>{label}</span>
          <InstallProgressLog log={log} />
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-text-muted" title={message}>
        <span>{label} install failed</span>
        <InstallProgressLog log={log} />
      </span>
    );
  }

  if (sessionEntries.length > 0 && activeProjectPath !== undefined) {
    return <LspStatusSection />;
  }

  // Profile detected but no server running yet (autoStart=onFirstFile) —
  // 显式标注安装态：绿点=已安装待启动，红点=未安装，灰点=探测中。
  if (primary) {
    const label = serverName(primary.languageId, primary.serverName);
    const markers = primary.markers.length > 0 ? primary.markers.join(', ') : 'project override';
    const hint =
      primaryInstalled === false
        ? `${label} is not installed — open a matching file to auto-install it.`
        : primaryInstalled === true
          ? `${label} is installed — open a matching file to start it.`
          : `${primary.languageId} (${markers}). Open a matching file to start ${label}.`;
    const dot =
      primaryInstalled === false
        ? 'bg-status-failed'
        : primaryInstalled === true
          ? 'bg-status-idle'
          : 'bg-text-muted';
    return (
      <span className="flex items-center gap-1.5 text-text-muted" title={hint}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return null;
}
