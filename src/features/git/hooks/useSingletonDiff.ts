import { useCallback, useMemo } from 'react';

import type { DiffSource } from '@/features/git/components/diff/types';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { CommitFileChange, ConnectionContext } from '@/shared/types';
import { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

const DIFF_TAB_ID = 'diff_singleton';

function fileNameOf(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function commitDiffSource(workspace: WorkspaceSession, commitHash: string): DiffSource {
  return { workspace, revision: { type: 'commit', commitHash } };
}

export function useSingletonDiff(
  projectId: ProjectId | undefined,
  commitHash: string | null,
  files: CommitFileChange[],
  connectionContext: ConnectionContext | null,
  activeCheckoutPath?: string | null,
) {
  // worktree 激活时使用 worktree 专属 tab key，避免 commit diff 落入 local tab 组
  // tab 的 projectId 直接持真实 id（值在手边就用法，不再从 tabKey 解回）
  const realProjectId = useProjectStore.getState().activeProjectId ?? projectId ?? '';
  // 身份值对象是唯一来源：键 = session.key（useMemo 稳定引用 → 下游 useCallback 不 churn）
  const session = useMemo(
    () => WorkspaceSession.of(realProjectId, activeCheckoutPath ?? null),
    [realProjectId, activeCheckoutPath],
  );
  const tabKey = session.key;

  const hasSingleton = useCallback(() => {
    const store = useEditorStore.getState();
    return Boolean(store.tabs[tabKey]?.tabs.find((t) => t.id === DIFF_TAB_ID));
  }, [tabKey]);

  const openFileInDiff = useCallback(
    (filePath: string) => {
      if (!commitHash || !connectionContext) return;
      const diffSource = commitDiffSource(session, commitHash);
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
        store.addTab({
          id: DIFF_TAB_ID,
          // 身份从 realProjectId（值在手边）经身份源构造，不从复合 tabKey 反解
          scope: { kind: 'workspace', session },
          title,
          order: 200,
          data: { kind: 'diff', ...partial },
        });
        store.activateTab(tabKey, DIFF_TAB_ID);
      }
    },
    [tabKey, session, commitHash, connectionContext],
  );

  const openCombined = useCallback(
    (currentFile?: string) => {
      if (!commitHash || !connectionContext) return;
      const targetPath = currentFile ?? files[0]?.path ?? '';
      if (!targetPath) return;
      const diffSource = commitDiffSource(session, commitHash);
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
        store.addTab({
          id: DIFF_TAB_ID,
          // 身份从 realProjectId（值在手边）经身份源构造，不从复合 tabKey 反解
          scope: { kind: 'workspace', session },
          title,
          order: 200,
          data: { kind: 'diff', ...partial },
        });
        store.activateTab(tabKey, DIFF_TAB_ID);
      }
    },
    [tabKey, session, commitHash, connectionContext, files],
  );

  const pinFile = useCallback(
    (filePath: string) => {
      if (!commitHash || !connectionContext) return;
      const diffSource = commitDiffSource(session, commitHash);
      const pinnedId = `diff_pinned_${filePath.replace(/[/\\]/g, '_')}`;
      const store = useEditorStore.getState();
      const fileName = fileNameOf(filePath);
      const title = `History Diff \u00b7 ${fileName}`;
      store.addTab({
        id: pinnedId,
        scope: { kind: 'workspace', session },
        title,
        order: 200,
        data: { kind: 'diff', filePath, fileName, diffSource },
      });
      store.activateTab(tabKey, pinnedId);
    },
    [tabKey, session, commitHash, connectionContext],
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
