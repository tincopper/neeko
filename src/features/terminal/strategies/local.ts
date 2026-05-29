import { useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useAppContext } from '@/shared/contexts';
import { useEditorContext } from '@/features/editor/context';
import {
  terminalCache,
  terminalRebuildCallbacks,
  terminalWrapperRefs,
  terminalCacheKey,
} from "../components/terminalCache";
import { setupTerminalLinks } from "../components/terminalLinks";
import type { TerminalStrategy } from "./types";

export function useLocalTerminalStrategy(
  paneId: string,
  worktreePathOverride?: string,
  worktreeBranchOverride?: string,
): TerminalStrategy | null {
  const { config } = useAppContext();
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
  const activeWorktreeBranch = useWorktreeStore((s) => s.activeWorktreeBranch);
  const { activeTabId, tabs } = useEditorContext();

  return useMemo(() => {
    const projectId = activeProject?.id ?? null;
    if (!projectId) return null;

    const effWorktreePath = worktreePathOverride ?? activeWorktreePath;
    const effWorktreeBranch = worktreeBranchOverride ?? activeWorktreeBranch;
    const isWorktree = !!effWorktreePath;
    const projectPath = effWorktreePath ?? activeProject?.path ?? null;
    const baseName = activeProject?.name ?? null;
    const projectName = baseName && effWorktreeBranch
      ? `${baseName} [${effWorktreeBranch}]`
      : baseName ?? null;

    const cacheKey = projectId
      ? isWorktree
        ? `${projectId}:wt:${effWorktreePath}:${activeTabId ?? "default"}:${paneId}`
        : terminalCacheKey(projectId, activeTabId, paneId)
      : `local:none:${paneId}`;

    return {
      kind: "local" as const,
      cacheKey,
      cache: terminalCache as unknown as Map<string, import("./types").CacheEntry>,
      rebuildCallbacks: terminalRebuildCallbacks,
      wrapperRefs: terminalWrapperRefs,
      createSession: async (cols: number, rows: number, payload?: { command?: string; configId?: string }) => {
        const session = await invoke<{ id: string }>(
          "create_terminal_session",
          {
            projectId,
            cols,
            rows,
            shell: config.shell || null,
            workingDir: projectPath || null,
            command: payload?.command ?? null,
          },
        );
        return session.id;
      },
      resizeCmd: "resize_terminal",
      agentDelayMs: 0,
      connectingMessage: `\x1b[33m[Terminal] Connecting to ${projectName ?? projectPath}...\x1b[0m\r\n`,
      fontSize: config.terminalFontSize,
      fontFamily: config.fontFamily ?? "",
      gpuAccel: config.terminalGpuAcceleration ?? false,
      outputFilter: (bytes: Uint8Array): Uint8Array => {
        const arr: number[] = [];
        for (const b of bytes) if (b !== 0x7f) arr.push(b);
        return arr.length > 0 ? new Uint8Array(arr) : new Uint8Array(0);
      },
      setupFileLinks: (term) => {
        if (projectPath) setupTerminalLinks(term, projectPath);
      },
    } satisfies TerminalStrategy;
  }, [
    activeProject,
    activeWorktreePath,
    activeWorktreeBranch,
    worktreePathOverride,
    worktreeBranchOverride,
    paneId,
    activeTabId,
    tabs,
    config.terminalFontSize,
    config.fontFamily,
    config.terminalGpuAcceleration,
    config.shell,
  ]);
}
