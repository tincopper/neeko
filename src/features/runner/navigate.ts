/**
 * Open the source file at a debug stop — read-only when it lives outside the
 * project (third-party / stdlib code) or when the adapter owns the bytes.
 *
 * Owns only the tab lifecycle: resolve identity → acquire content via
 * `sourceContent` → open / activate + record navigation. Failure is reported
 * through the injected `onError` so this module never imports a store
 * (no `navigate` ↔ `debugStore` cycle) and mirrors go-to-definition navigation
 * through the editor store + file IPC.
 */
import { useEditorStore } from '@/shared/store/editorStore';
import {
  captureCurrentNavLocation,
  recordNavigationJump,
} from '@/shared/store/navigationHistoryStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Tab } from '@/shared/types';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';
import { fileRefFromTabPath, sourceIdentityOf } from '@/shared/utils/fileRef';
import { getFileName, getTabId, isFileTab } from '@/shared/utils/fileTree';
import { resolveTabKey } from '@/shared/utils/tabKey';

import {
  loadStopSourceContent,
  loadVirtualSourceContent,
  virtualSourceIdentity,
  type StopSourceContent,
} from './sourceContent';

export interface OpenSourceOptions {
  /** Live debug session id — required for external / virtual sources. */
  sessionId?: string;
  /** Failure sink (e.g. Debug Console). Keeps this module store-free. */
  onError?: (message: string) => void;
}

function describeError(error: unknown): string {
  return String(error).replace(/^Error:\s*/, '');
}

/** Tab space key for the current project / worktree; empty when unavailable. */
function stopTabKey(projectId: string): string {
  const activeWorktree = useWorktreeStore.getState().activeWorktreePath;
  return projectId ? resolveTabKey(projectId, activeWorktree) : projectId;
}

/** 打开（或复用）一个停止点源码 tab 的请求。 */
interface StopTabRequest {
  tabKey: string;
  projectId: string;
  /**
   * **规范身份**（见 `sourceIdentityOf`）：tab 查找、断点 key、黄线共用它，
   * 故不存在「同一文件两份身份」的别名匹配。
   */
  identity: string;
  tabTitle: string;
  line: number;
  column: number;
  /**
   * 内容加载器。**身份与内容来源可不同**：JDK 源码的 tab 身份是 jdt 形态，内容却
   * 来自 src.zip 解压出的缓存文件；而同身份 tab 已打开时根本不会调用它。
   */
  load: () => Promise<StopSourceContent>;
  opts?: OpenSourceOptions;
}

/**
 * Open (or re-activate) the tab for a stop source. Shared by the filesystem and
 * adapter-virtual flows — the only difference is the identity + content loader.
 *
 * 参数用具名对象而非位置参数：`line` / `column` 相邻且同类型，位置传参写错不会
 * 被类型系统拦住。
 */
async function openStopTab({
  tabKey,
  projectId,
  identity,
  tabTitle,
  line,
  column,
  load,
  opts,
}: StopTabRequest): Promise<void> {
  const store = useEditorStore.getState();
  const existing = (store.tabs[tabKey]?.tabs ?? [])
    .filter(isFileTab)
    .find((t) => t.data.filePath === identity);

  const line1 = Math.max(1, line);
  const col = Math.max(0, column);
  // Captured before opening so "back" returns to where the jump started; only
  // recorded once the file actually opens (a failed load must not pollute the
  // navigation history).
  const from = captureCurrentNavLocation();
  const to = { projectId, tabKey, filePath: identity, line: line1, column: col };

  if (existing) {
    recordNavigationJump(from, to);
    store.activateTab(tabKey, existing.id);
    store.setPendingNavigateTarget({ tabKey, tabId: existing.id, line: line1, col, debug: true });
    return;
  }

  const loaded = await load();
  if (loaded.kind === 'failed') {
    console.error('[DAP] Failed to open source:', identity, loaded.error);
    opts?.onError?.(`Failed to open source: ${identity} (${describeError(loaded.error)})`);
    return;
  }

  const fresh = useEditorStore.getState();
  const tabId = getTabId(tabKey, identity);
  const newTab: Tab = {
    id: tabId,
    projectId,
    title: tabTitle,
    order: fresh.tabs[tabKey]?.tabs.length ?? 0,
    data: {
      kind: 'file',
      filePath: identity,
      fileName: tabTitle,
      content: loaded.content,
      isDirty: false,
      // External / virtual sources are read-only: no save path, no dirty tracking.
      readOnly: loaded.kind === 'project' ? undefined : true,
    },
  };
  recordNavigationJump(from, to);
  fresh.addTab(tabKey, newTab);
  fresh.setPendingNavigateTarget({ tabKey, tabId, line: line1, col, debug: true });
}

export async function openSourceAtLine(
  projectId: string,
  projectPath: string,
  sourcePath: string,
  line: number,
  column = 0,
  opts?: OpenSourceOptions,
): Promise<void> {
  // Fall back to active project path when session snapshot is incomplete.
  const resolvedProjectPath = projectPath || useProjectStore.getState().activeProject?.path || '';
  // 身份与内容来源分开：
  // - `identity` 是**规范 tab 身份**（对 jdt 形态拼根会得到不存在的路径，故一律走
  //   FileRef；JDK 解压缓存路径、`jdt://` 帧 uri 也在此收敛成 jdt 身份，使断点 key /
  //   黄线 / tab 复用天然一致）；
  // - `loadPath` 是交给内容通道的**源引用**（jdt 身份由后端翻译成真实文件；缓存文件
  //   本身就是磁盘上的真文件）。
  const ref = fileRefFromTabPath(resolvedProjectPath, sourcePath);
  const identity = sourceIdentityOf(resolvedProjectPath, sourcePath);
  const loadPath = ref.kind === 'fs' ? ref.path : identity;
  preloadLanguageExtension(identity);

  const tabKey = stopTabKey(projectId);
  if (!tabKey) return;

  // jdt 身份同样可从内容通道取得：后端把身份翻译成真实文件（缓存命中或从 JDK
  // `src.zip` / 依赖 `-sources.jar` 落盘），失败时给出可操作原因（而非旧文案
  // "virtual document is not open" —— 那也是"停住了却看不到源码"的一种）。
  const load = () => loadStopSourceContent(projectId, loadPath, opts?.sessionId);

  await openStopTab({
    tabKey,
    projectId,
    identity,
    tabTitle: getFileName(identity),
    line,
    column,
    load,
    opts,
  });
}

/**
 * Open a frame's virtual source (DAP `sourceReference`) — the adapter owns the
 * bytes, there is no filesystem path (remote debuggees / debuggee-provided
 * sources). Tab identity is the synthetic `dap-source:` path.
 */
export async function openVirtualSourceAtLine(
  projectId: string,
  sourceName: string | null | undefined,
  reference: number,
  line: number,
  column = 0,
  opts?: OpenSourceOptions,
): Promise<void> {
  const sessionId = opts?.sessionId;
  if (!sessionId || reference <= 0) return;
  const identity = virtualSourceIdentity(reference, sourceName);
  const title = sourceName?.trim() || getFileName(identity);
  preloadLanguageExtension(identity);

  const tabKey = stopTabKey(projectId);
  if (!tabKey) return;

  await openStopTab({
    tabKey,
    projectId,
    identity,
    tabTitle: title,
    line,
    column,
    load: () => loadVirtualSourceContent(sessionId, identity, reference),
    opts,
  });
}

export function activeProjectPaths(): { projectId: string; projectPath: string } | null {
  const p = useProjectStore.getState().activeProject;
  if (!p?.id || !p.path) return null;
  return { projectId: p.id, projectPath: p.path };
}
