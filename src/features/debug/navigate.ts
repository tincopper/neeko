/**
 * Open a source file at a line when the debugger stops.
 * Mirrors go-to-definition navigation using editor store + file IPC.
 */
import { readFileContent } from '@/features/file/api/fileApi';
import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useEditorStore } from '@/shared/store';
import type { Tab } from '@/shared/types';
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';
import { getFileName, getTabId } from '@/shared/utils/fileTree';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';

/** Convert absolute path to project-relative if under workspace. */
export function toProjectRelative(projectPath: string, absPath: string): string {
  const normProj = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normFile = absPath.replace(/\\/g, '/');
  if (normFile.startsWith(normProj + '/')) {
    return normFile.slice(normProj.length + 1);
  }
  if (normFile === normProj) return normFile;
  return absPath;
}

export async function openSourceAtLine(
  projectId: string,
  projectPath: string,
  sourcePath: string,
  line: number,
  column = 0,
): Promise<void> {
  // Fall back to active project path when session snapshot is incomplete.
  const resolvedProjectPath =
    projectPath ||
    useProjectStore.getState().activeProject?.path ||
    '';
  const filePath = resolvedProjectPath
    ? toProjectRelative(resolvedProjectPath, sourcePath)
    : sourcePath.replace(/\\/g, '/');
  preloadLanguageExtension(filePath);

  const activeWorktree = useWorktreeStore.getState().activeWorktreePath;
  const tabKey =
    activeWorktree && projectId
      ? buildWorktreeTabKey(projectId, activeWorktree)
      : projectId;

  if (!tabKey) return;

  const store = useEditorStore.getState();
  const existing = store.tabs[tabKey]?.tabs.find(
    (t) => t.data.kind === 'file' && t.data.filePath === filePath,
  );

  const line1 = Math.max(1, line);
  const col = Math.max(0, column);

  if (existing) {
    store.activateTab(tabKey, existing.id);
    store.setPendingNavigateTarget({
      tabKey,
      tabId: existing.id,
      line: line1,
      col,
    });
    return;
  }

  try {
    const content = await readFileContent(projectId, filePath, null);
    const tabId = getTabId(tabKey, filePath);
    const newTab: Tab = {
      id: tabId,
      projectId,
      title: getFileName(filePath),
      order: store.tabs[tabKey]?.tabs.length ?? 0,
      data: {
        kind: 'file',
        filePath,
        fileName: getFileName(filePath),
        content,
        isDirty: false,
      },
    };
    store.addTab(tabKey, newTab);
    store.setPendingNavigateTarget({
      tabKey,
      tabId,
      line: line1,
      col,
    });
  } catch (e) {
    console.error('[DAP] Failed to open source:', sourcePath, e);
  }
}

export function activeProjectPaths(): { projectId: string; projectPath: string } | null {
  const p = useProjectStore.getState().activeProject;
  if (!p?.id || !p.path) return null;
  return { projectId: p.id, projectPath: p.path };
}
