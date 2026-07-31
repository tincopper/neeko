import { useCallback } from 'react';

import type { DiffSource } from '@/features/git/components/diff/types';
import { useEditorStore } from '@/shared/store';
import { useProjectStore } from '@/shared/store/projectStore';
import type { CommitFileChange, ConnectionContext } from '@/shared/types';
import { parseProjectIdFromTabKey, resolveTabKey } from '@/shared/utils/tabKey';

const DIFF_TAB_ID = 'diff_singleton';

function fileNameOf(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function buildDiffSource(connectionContext: ConnectionContext, commitHash: string): DiffSource {
  switch (connectionContext.type) {
    case 'local':
      return { type: 'commit', projectId: connectionContext.projectId, commitHash };
    case 'wsl':
      return {
        type: 'wsl-commit',
        distro: connectionContext.distro,
        projectPath: connectionContext.projectPath,
        commitHash,
      };
    case 'remote':
      return {
        type: 'remote-commit',
        host: connectionContext.host,
        port: connectionContext.port,
        username: connectionContext.username,
        auth: connectionContext.auth,
        projectPath: connectionContext.projectPath,
        commitHash,
      };
  }
}

export function useSingletonDiff(
  projectId: string | undefined,
  commitHash: string | null,
  files: CommitFileChange[],
  connectionContext: ConnectionContext | null,
  activeWorktreePath?: string | null,
) {
  // worktree 激活时使用 worktree 专属 tab key，避免 commit diff 落入 local tab 组
  const tabKey = resolveTabKey(
    useProjectStore.getState().activeProjectId ?? projectId ?? '',
    activeWorktreePath,
  );

  const hasSingleton = useCallback(() => {
    const store = useEditorStore.getState();
    return Boolean(store.tabs[tabKey]?.tabs.find((t) => t.id === DIFF_TAB_ID));
  }, [tabKey]);

  const openFileInDiff = useCallback(
    (filePath: string) => {
      if (!commitHash || !connectionContext) return;
      const diffSource = buildDiffSource(connectionContext, commitHash);
      const store = useEditorStore.getState();
      const existing = store.tabs[tabKey]?.tabs.find((t) => t.id === DIFF_TAB_ID);
      const fileName = fileNameOf(filePath);
      const title = `History Diff \u00b7 ${fileName}`;
      const partial = {
        title,
        filePath,
        fileName,
        diffSource,
        combined: false,
        combinedFiles: undefined,
        scrollToPath: undefined,
      };
      if (existing) {
        store.updateTab(tabKey, DIFF_TAB_ID, partial);
        store.activateTab(tabKey, DIFF_TAB_ID);
      } else {
        store.addTab(tabKey, {
          id: DIFF_TAB_ID,
          // tab 的 projectId 必须是真实 project id，不能用复合 worktree tab key
          //（否则后端 resolve_project 找不到项目）
          projectId: parseProjectIdFromTabKey(tabKey),
          title,
          order: 200,
          data: { kind: 'diff', ...partial },
        });
        store.activateTab(tabKey, DIFF_TAB_ID);
      }
    },
    [tabKey, commitHash, connectionContext],
  );

  const openCombined = useCallback(
    (currentFile?: string) => {
      if (!commitHash || !connectionContext) return;
      const targetPath = currentFile ?? files[0]?.path ?? '';
      if (!targetPath) return;
      const diffSource = buildDiffSource(connectionContext, commitHash);
      const title = `History Commit \u00b7 ${commitHash.slice(0, 7)} \u00b7 ${files.length} files`;
      const store = useEditorStore.getState();
      const existing = store.tabs[tabKey]?.tabs.find((t) => t.id === DIFF_TAB_ID);
      const partial = {
        title,
        filePath: targetPath,
        fileName: fileNameOf(targetPath),
        diffSource,
        combined: true,
        combinedFiles: files,
        scrollToPath: currentFile ?? undefined,
      };
      if (existing) {
        store.updateTab(tabKey, DIFF_TAB_ID, partial);
        store.activateTab(tabKey, DIFF_TAB_ID);
      } else {
        store.addTab(tabKey, {
          id: DIFF_TAB_ID,
          // tab 的 projectId 必须是真实 project id，不能用复合 worktree tab key
          //（否则后端 resolve_project 找不到项目）
          projectId: parseProjectIdFromTabKey(tabKey),
          title,
          order: 200,
          data: { kind: 'diff', ...partial },
        });
        store.activateTab(tabKey, DIFF_TAB_ID);
      }
    },
    [tabKey, commitHash, connectionContext, files],
  );

  const pinFile = useCallback(
    (filePath: string) => {
      if (!commitHash || !connectionContext) return;
      const diffSource = buildDiffSource(connectionContext, commitHash);
      const pinnedId = `diff_pinned_${filePath.replace(/[/\\]/g, '_')}`;
      const store = useEditorStore.getState();
      const fileName = fileNameOf(filePath);
      const title = `History Diff \u00b7 ${fileName}`;
      store.addTab(tabKey, {
        id: pinnedId,
        projectId: parseProjectIdFromTabKey(tabKey),
        title,
        order: 200,
        data: { kind: 'diff', filePath, fileName, diffSource },
      });
      store.activateTab(tabKey, pinnedId);
    },
    [tabKey, commitHash, connectionContext],
  );

  const scrollToFile = useCallback(
    (filePath: string) => {
      const store = useEditorStore.getState();
      const existing = store.tabs[tabKey]?.tabs.find((t) => t.id === DIFF_TAB_ID);
      if (!existing) return;
      // Force effect re-run even when clicking the same file twice.
      store.updateTab(tabKey, DIFF_TAB_ID, {
        filePath,
        fileName: fileNameOf(filePath),
        scrollToPath: undefined,
      });
      store.updateTab(tabKey, DIFF_TAB_ID, { scrollToPath: filePath });
      store.activateTab(tabKey, DIFF_TAB_ID);
    },
    [tabKey],
  );

  /** Refresh singleton Diff tab after commit selection changes (if already open). */
  const refreshOpenDiff = useCallback(
    (opts: { combined: boolean; preferredPath?: string | null }) => {
      if (!commitHash || !connectionContext || !hasSingleton()) return;
      if (files.length === 0) return;

      const preferred = opts.preferredPath ?? null;
      const activePath =
        preferred && files.some((f) => f.path === preferred) ? preferred : files[0].path;

      if (opts.combined) {
        openCombined(activePath);
      } else {
        openFileInDiff(activePath);
      }
    },
    [commitHash, connectionContext, files, hasSingleton, openCombined, openFileInDiff],
  );

  return {
    openFileInDiff,
    openCombined,
    pinFile,
    scrollToFile,
    refreshOpenDiff,
    hasSingleton,
    DIFF_TAB_ID,
  };
}
