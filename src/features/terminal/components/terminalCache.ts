import { emit } from '@tauri-apps/api/event';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

import { resolveAgent } from '@/shared/store/agentStore';
import { buildAgentCommand } from '@/shared/utils/agentCommand';
import { reportFrontendError } from '@/shared/utils/errorReporting';
import { safeDisposeTerminal } from '@/shared/utils/terminal';
import { terminalInputEvent } from '@/shared/utils/terminalEvents';
import type { TerminalInputController } from '@/shared/utils/terminalInput';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { closeTerminalSession, detachTerminalSession } from '../api/terminalApi';

import {
  terminalAddress,
  terminalAddressPrefix,
  terminalAddressPrefixOfTab,
  terminalKeyLabel,
} from './terminalAddress';
import type { TerminalCache } from './terminalTypes';

// =============================================================================
// Factory — shared by local / WSL / remote cache modules
// =============================================================================
/** Minimal common shape that all three cache types satisfy. */
interface CacheEntry {
  term: Terminal;
  sessionId: string | null;
  inputController: TerminalInputController | null;
  unlisten?: (() => void) | null;
  unlistenOutput?: (() => void) | null;
  unlistenClosed?: (() => void) | null;
}
export interface CacheBackendOptions {
  /** Close a terminal session */
  closeSession: (sessionId: string) => Promise<void>;
  /** Log prefix, e.g. "[WSL]", "[SSH]", "[Terminal]" */
  logPrefix: string;
}
export function createTerminalCacheBackend<TCache extends CacheEntry>(
  options: CacheBackendOptions,
) {
  const { closeSession, logPrefix } = options;

  // ---- internal maps ----
  const cache = new Map<string, TCache>();
  const rebuildCallbacks = new Map<string, () => void>();
  const wrapperRefs = new Map<string, HTMLDivElement>();

  // ---- utilities ----

  function log(msg: string) {
    const ts = new Date().toLocaleTimeString();
    console.debug(`['${ts}'] ${logPrefix} ${msg}`);
  }

  /**
   * 销毁缓存条目。
   *
   * `keepSession` = 只拆界面，**不结束进程**（「后台运行」）。此时必须先把后端 drain
   * 切到分离态，否则没有消费者却照常背压，PTY 写入会堵死、后台 agent 冻住。
   *
   * 分离态在这里切而不是在关闭编排里切：一个 tab 可以拆成多个 pane、各自一条 PTY，
   * 只有这里能枚举到**全部** session id（编排层只看到 `tab.data.ptySessionId` 一个）。
   */
  function destroyCache(key: string, options: { keepSession?: boolean } = {}): void {
    const entry = cache.get(key);
    if (!entry) return;

    if (entry.unlisten) entry.unlisten();
    if (entry.unlistenOutput) entry.unlistenOutput();
    if (entry.unlistenClosed) entry.unlistenClosed();

    entry.inputController?.dispose();
    safeDisposeTerminal(entry.term);

    if (entry.sessionId) {
      if (options.keepSession) {
        // 后台运行：进程留着，drain 转分离态（只留尾部，不背压）。每个 pane 各切一次。
        detachTerminalSession(entry.sessionId, true).catch((err) =>
          reportFrontendError('terminal.detachSession', err),
        );
      } else {
        closeSession(entry.sessionId).catch((err) =>
          reportFrontendError('terminal.closeSession', err),
        );
      }
    }

    cache.delete(key);
    rebuildCallbacks.delete(key);
    wrapperRefs.delete(key);

    // 键含 NUL / SEP（不可读且会让日志文件被 `file(1)` 判成 data），一律经 `terminalKeyLabel`。
    log(`Cache destroyed for ${terminalKeyLabel(key)}`);
  }

  /** 精确键刷新（键由 terminal 寻址层 mint，本层不再做前缀消解）。 */
  function refreshTerminal(key: string): void {
    const entry = cache.get(key);
    if (!entry) return;

    const rebuildCb = rebuildCallbacks.get(key);

    if (entry.unlisten) entry.unlisten();
    if (entry.unlistenOutput) entry.unlistenOutput();
    if (entry.unlistenClosed) entry.unlistenClosed();
    entry.inputController?.dispose();

    if (entry.sessionId) {
      closeSession(entry.sessionId).catch((err) =>
        reportFrontendError('terminal.closeSession', err),
      );
    }

    safeDisposeTerminal(entry.term);

    cache.delete(key);
    rebuildCallbacks.delete(key);
    wrapperRefs.delete(key);

    log(`Cache destroyed for ${terminalKeyLabel(key)}`);

    rebuildCb?.();
  }

  function launchAgentInTerminal(key: string, command: string, args: string[]): void {
    const entry = cache.get(key);
    if (!entry?.sessionId) return;

    const sessionId = entry.sessionId;
    const ctrlC = Array.from(new TextEncoder().encode('\x03'));
    // 静默豁免：终端高频输入，尽力而为，失败无需上报
    emit(terminalInputEvent(sessionId), ctrlC).catch(() => {});

    setTimeout(() => {
      const cmdStr = buildAgentCommand({ command, args }) + '\r';
      const bytes = Array.from(new TextEncoder().encode(cmdStr));
      // 静默豁免：终端高频输入，尽力而为，失败无需上报
      emit(terminalInputEvent(sessionId), bytes).catch(() => {});
    }, 50);
  }

  return {
    cache,
    rebuildCallbacks,
    wrapperRefs,
    destroyCache,
    refreshTerminal,
    launchAgentInTerminal,
    log,
  };
}

// =============================================================================
// Local terminal cache — instance and exports
// =============================================================================

const backend = createTerminalCacheBackend<TerminalCache>({
  closeSession: closeTerminalSession,
  logPrefix: '[Terminal]',
});

export const terminalCache = backend.cache;
export const terminalRebuildCallbacks = backend.rebuildCallbacks;
export const terminalWrapperRefs = backend.wrapperRefs;

export const log = backend.log;

// =============================================================================
// WSL terminal cache — instance and exports
// =============================================================================

export interface WslTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
  unlistenOutput: (() => void) | null;
  unlistenClosed: (() => void) | null;
  inputController: TerminalInputController | null;
}

const wslBackend = createTerminalCacheBackend<WslTerminalCache>({
  closeSession: closeTerminalSession,
  logPrefix: '[WSL]',
});

export const wslTerminalCache = wslBackend.cache;
export const wslRebuildCallbacks = wslBackend.rebuildCallbacks;
export const wslWrapperRefs = wslBackend.wrapperRefs;

// =============================================================================
// Remote terminal cache — instance and exports
// =============================================================================

export interface RemoteTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
  unlistenOutput: (() => void) | null;
  unlistenClosed: (() => void) | null;
  inputController: TerminalInputController | null;
}

const remoteBackend = createTerminalCacheBackend<RemoteTerminalCache>({
  closeSession: closeTerminalSession,
  logPrefix: '[SSH]',
});

export const remoteTerminalCache = remoteBackend.cache;
export const remoteRebuildCallbacks = remoteBackend.rebuildCallbacks;
export const remoteWrapperRefs = remoteBackend.wrapperRefs;

// =============================================================================
// Terminal addressing — env-blind address → physical cache key (single mint)
// =============================================================================
// 地址材质（分隔符常量 / `terminalAddress` / `decodeTerminalKey` / `terminalKeyLabel`）
// 已抽出到同级 `terminalAddress.ts`（唯一 mint 文件，护栏 `check_terminal_key_mint` 的
// MINT_FILE 随之迁移）。本文件只**消费**地址，不再铸造 —— 因此只 import 而不 re-export
// 材质符号（re-export 会让分隔符标识符再次出现在本文件而被 G3 拦下）。

interface TerminalBackendHandle {
  cache: Map<string, CacheEntry>;
  wrapperRefs: Map<string, HTMLDivElement>;
  rebuildCallbacks: Map<string, () => void>;
  destroyCache: (key: string, options?: { keepSession?: boolean }) => void;
  refreshTerminal: (key: string) => void;
  launchAgentInTerminal: (key: string, cmd: string, args: string[]) => void;
}

/**
 * 三个物理 Map（传输归属，非寻址维度）。键在它们之间**唯一**（一个 terminal 只属一个 env），
 * 所以整个地址层可以只靠键/前缀在 Map 中查找，**不需要读 projectStore 反推 env**
 * （移除隐藏 store 依赖与「env 未知就静默 no-op」的泄漏面）。
 */
function allBackends(): TerminalBackendHandle[] {
  return [backend, wslBackend, remoteBackend] as unknown as TerminalBackendHandle[];
}

/** 精确键唯一命中其物理 Map；未命中 → null。 */
function backendForKey(key: string): TerminalBackendHandle | null {
  for (const bk of allBackends()) {
    if (bk.cache.has(key)) return bk;
  }
  return null;
}

/**
 * 精确键 resolve：调用方**确实知道 paneId** 时用它（三个物理 Map 中唯一命中）。
 *
 * **`paneId` 必填、无默认值** —— 曾经的默认值 `'p1'` 是 2026-11 「拖文件到终端什么都没发生」
 * 事故的根因：paneId 是**渲染方**才知道的知识，猜一个默认值在终端不在第一个 pane
 * （右侧 dock / 分屏）时恒 miss，而调用方只拿到一个静默的 `false`。
 * 「只知道 tab、不知道 pane」的写侧路径请用 `resolveTerminalEntryOfTab`。
 */
export function resolveTerminalEntry(
  session: WorkspaceSession,
  tabId: string,
  paneId: string,
): CacheEntry | null {
  const key = terminalAddress(session, tabId, paneId);
  return backendForKey(key)?.cache.get(key) ?? null;
}

/**
 * tab 级、**pane 无关**的 resolve：该 tab 任意一条存活 PTY（`terminalAddressPrefixOfTab` 扫描）。
 *
 * 服务对象是「只持有 tab 身份」的写侧调用方（`sendToTerminal` / `insertToTerminalTarget`）——
 * 它们不知道这个 tab 被拆成几个 pane、每个 pane 的 paneId 是什么（那是渲染方的知识）。
 *
 * 命中顺序：三个物理 Map（键共唯一）+ **键字典序**（`paneId` 是键的末段，因此等价于
 * paneId 升序）。排序是为了确定性：不排序就是「Map 插入顺序」，那是同一问题第二个
 * 答案的温床（决议 Q2 判过的形态）。
 *
 * 「优先激活 pane」**不在本层回答** —— pane 激活态只有渲染方知道，拖拽投递走的是端口模型
 * （`shared/inputs/insertPorts`，每个 pane 自带自己的 PTY），本函数只服务「按 tab 写入」
 * 这条没有 pane 上下文的路径。
 */
export function resolveTerminalEntryOfTab(
  session: WorkspaceSession,
  tabId: string,
): CacheEntry | null {
  const prefix = terminalAddressPrefixOfTab(session, tabId);
  for (const bk of allBackends()) {
    const keys = [...bk.cache.keys()].filter((key) => key.startsWith(prefix)).sort();
    for (const key of keys) {
      const entry = bk.cache.get(key);
      if (entry?.sessionId) return entry;
    }
  }
  return null;
}

/**
 * ③ 面：切换该 session 内某 tab 的 agent（WSL/Remote 共用——键唯一命中其物理 Map）。
 *
 * WSL/Remote 的 agent 切换不重建 PTY，只清缓存并触发 pane 重建回调；
 * 无 wrapper 时降级为「向该键下发 agent 命令」。
 */
export async function switchAgentInSessionTerminal(
  session: WorkspaceSession,
  tabId: string,
  agentId: string,
): Promise<void> {
  const resolvedKey = terminalAddress(session, tabId);
  const bk = backendForKey(resolvedKey);
  if (!bk) return;

  const wrapper = bk.wrapperRefs.get(resolvedKey);
  if (!wrapper) {
    // 命令的唯一来源是 agent 缓存（后端 `AgentManager` 的快照）。
    // 未命中 = 缓存还没加载或该 agent 已被删除 —— 此时**不启动**，
    // 而不是猜一个命令（旧的 `override ?? agent.command` 正是漂移源头）。
    const agent = await resolveAgent(agentId);
    if (!agent) {
      console.warn('[Terminal] agent not in cache, skipping launch:', agentId);
      return;
    }
    bk.launchAgentInTerminal(resolvedKey, agent.command, agent.args);
    return;
  }

  const oldCache = bk.cache.get(resolvedKey);
  if (oldCache) {
    oldCache.unlisten?.();
    oldCache.unlistenOutput?.();
    oldCache.unlistenClosed?.();
    oldCache.inputController?.dispose();
  }

  bk.cache.delete(resolvedKey);

  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild);
  }

  bk.rebuildCallbacks.get(resolvedKey)?.();

  if (oldCache?.sessionId) {
    closeTerminalSession(oldCache.sessionId).catch((err) =>
      reportFrontendError('terminal.closeSession', err),
    );
  }
  if (oldCache?.term) safeDisposeTerminal(oldCache.term);
}

function destroyTerminalsByPrefix(prefix: string, options: { keepSession?: boolean } = {}): void {
  for (const bk of allBackends()) {
    for (const key of Array.from(bk.cache.keys())) {
      if (key.startsWith(prefix)) bk.destroyCache(key, options);
    }
  }
}

/** ③ 面：销毁该 session 下全部终端（删 worktree / 清 tab 空间）。 */
export function destroyTerminalsForSession(session: WorkspaceSession): void {
  destroyTerminalsByPrefix(terminalAddressPrefix(session));
}

/**
 * ③ 面：销毁某项目**所有 workspace**（主仓 + 全部 worktree、全 env）的终端。
 * 用于「关项目 / 删 entry」——项目级关闭语义就是所有单元。
 * 前缀 = `projectId` + NUL（session.key 的第一段），UUID 后接 NUL 使跨项目无歧义。
 */
export function destroyTerminalsForProject(projectId: ProjectId): void {
  // 主 checkout 的 session.key 就是 `<projectId>\0`（第一段 + NUL）——
  // 由唯一 mint 投影得到，不在本模块重拼 NUL。
  destroyTerminalsByPrefix(WorkspaceSession.of(projectId, null).key);
}

/** ③ 面：销毁该 session 下某个 tab 的终端（关闭单个 tab）。
 *
 * `keepSession` = 「后台运行」：只拆界面，进程留着继续跑（见 `destroyCache`）。
 */
export function destroyTerminalsForTab(
  session: WorkspaceSession,
  tabId: string,
  options: { keepSession?: boolean } = {},
): void {
  destroyTerminalsByPrefix(terminalAddressPrefixOfTab(session, tabId), options);
}

/** ③ 面：刷新该 session 的终端；给定 tabId 精确，否则首个（agent 切换 / 重建自愈）。 */
export function refreshTerminalForSession(session: WorkspaceSession, tabId: string): void {
  const key = terminalAddress(session, tabId);
  backendForKey(key)?.refreshTerminal(key);
}

/**
 * 精确键刷新任意 env 的终端（键在三个物理 Map 中唯一命中其一）。
 * 供自愈路径使用 —— 调用方持有 strategy 的完整键，无需知道 env。
 */
export function refreshTerminalEntry(key: string): void {
  backendForKey(key)?.refreshTerminal(key);
}
