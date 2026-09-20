import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';

import {
  LSP_DIAG_EVENT_PREFIX,
  LSP_PROFILE_EVENT,
  LSP_PROGRESS_EVENT_PREFIX,
  LSP_SESSION_EVENT_PREFIX,
} from '@/shared/events';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { applyBackendExtensionMap } from '../api/languageMap';
import {
  lspCheckServerInstalled,
  lspDetectProjectProfile,
  lspGetExtensionConflicts,
  lspGetExtensionMap,
  type LspExtensionConflictDto,
} from '../api/lspApi';
import type { LspDiagnosticsEvent, LspDiagnostic, ProjectLanguageProfile } from '../types';

export interface LspInstallProgress {
  language_id: string;
  phase: 'installing' | 'done' | 'error';
  message: string;
  /** 累计安装日志（stdout/stderr 行），安装中实时更新，可展开查看。 */
  log: string;
}

export interface LspSessionState {
  languageId: string;
  serverName: string;
  status: 'starting' | 'initializing' | 'indexing' | 'ready' | 'error' | 'stopped';
  statusMessage?: string;
  progressPct?: number;
}

interface LspSessionStatusEventPayload {
  languageId: string;
  status: string;
  message?: string;
  progressPct?: number;
}

interface LspProgressEventPayload {
  languageId: string;
  token: string;
  kind: string;
  message?: string | null;
  percentage?: number | null;
}

/** Busy-equivalent session statuses (green must not show while these hold). */
const BUSY_STATUS: Record<string, true> = { starting: true, initializing: true, indexing: true };

/**
 * 新会话起点：上一会话的 token 空间与诊断副本都随之失效。
 *
 * 重启是**替换**而非结束（后端重启路径刻意不推 `stopped`，否则状态栏 chip 会在
 * close→create 之间被过滤掉、出现闪断），所以"旧事实失效"必须挂在新会话起点上，
 * 否则死进程不再推送的诊断会永久残留成陈旧波浪线。
 */
const NEW_SESSION_STATUS: Record<string, true> = { starting: true, initializing: true };

/** 会话终态：不再可能推送任何数据（design.md M1 矩阵「会话结束 → 整体清除」）。 */
const TERMINAL_STATUS: Record<string, true> = { error: true, stopped: true };

/** Map languageId → representative file for CodeMirror lang preload. */
const LANG_PRELOAD_FILE: Record<string, string> = {
  go: 'main.go',
  rust: 'main.rs',
  typescript: 'index.ts',
  typescriptreact: 'App.tsx',
  javascript: 'index.js',
  javascriptreact: 'App.jsx',
  python: 'main.py',
  java: 'Main.java',
  cpp: 'main.cpp',
  c: 'main.c',
};

interface LspStoreState {
  sessions: Record<string, Record<string, LspSessionState>>;
  /** Detected profile per project path (marker scan, may have no running session). */
  profiles: Record<string, ProjectLanguageProfile>;
  /** Extension routing conflicts from the live registry. */
  extensionConflicts: LspExtensionConflictDto[];
  /** 自动安装进度（常驻 InstallProgressBridge 写入，LspSlotItem 读取）。 */
  installProgress: LspInstallProgress | null;
  /**
   * 诊断事实的**权威副本**（不变量 I1）：projectPath → uri → 诊断数组。
   * 由 subscribeToProject 直采 `lsp-diagnostics-{projectPath}` 事件写入。
   *
   * 消费面有两个，都是它的**投影**：
   * - Problems 面板：直接派生（本 store 切片）；
   * - 编辑器波浪线：由 lsp-client 独立消费同一事件流做坐标映射，其映射结果由
   *   `lsp/hooks/lspDiagnosticsProjection.ts` 持存并在 CM 配置重建后自愈（不变量 I2）。
   * 两个投影从同一事件派生，但生命周期不同（会话 vs 一次编辑器配置代）——
   * 一致由「投影可重建」保证，不靠「两边各存一份、永不丢失」的假设。
   */
  diagnosticsByProject: Record<string, Record<string, LspDiagnostic[]>>;
  /** Problems 底部面板可见性（ProblemsPanel 自渲染开关 + ProblemsItem 计数入口）。 */
  problemsPanelOpen: boolean;
  setProblemsPanelOpen: (open: boolean) => void;
  toggleProblemsPanel: () => void;
  /**
   * 整体替换该 uri 的诊断（publishDiagnostics 语义 = 全量推送，非合并）；
   * 空 arrays 即清空该 uri（规范语义）。
   */
  setProjectDiagnostics: (projectPath: string, uri: string, diagnostics: LspDiagnostic[]) => void;
  /**
   * 一次替换多个 uri 的诊断（P1 突发收敛用）：与 `setProjectDiagnostics` 语义一致
   * （每个 uri 整体替换），但合并为**单次** set，避免 N 次发布触发 N 次订阅通知。
   */
  setProjectDiagnosticsBatch: (
    projectPath: string,
    entries: Array<[string, LspDiagnostic[]]>,
  ) => void;
  /** 会话结束 / 项目移除：对应 projectPath 键整体清除。 */
  clearProjectDiagnostics: (projectPath: string) => void;
  setInstallProgress: (progress: LspInstallProgress | null) => void;
  /** 显式跳转（F12 / Cmd+Click）进行中：UI 据此显示 loading 光标。 */
  isDefinitionJumping: boolean;
  setDefinitionJumping: (jumping: boolean) => void;
  /**
   * Open work-done-progress tokens per project → language.
   * 后端任意 progress `end` 即推 session `ready`；jdtls 并发多 token 时短任务
   * 先 end 会把长导入的 busy 覆盖——前端以此引用计数为准：非空即 busy。
   */
  progressTokens: Record<string, Record<string, string[]>>;
  addProgressToken: (projectPath: string, languageId: string, token: string) => void;
  removeProgressToken: (projectPath: string, languageId: string, token: string) => void;
  clearProgressTokens: (projectPath: string, languageId: string) => void;
  setSessionState: (
    projectPath: string,
    languageId: string,
    state: Partial<LspSessionState>,
  ) => void;
  removeSession: (projectPath: string, languageId: string) => void;
  setProfile: (profile: ProjectLanguageProfile) => void;
  setExtensionConflicts: (conflicts: LspExtensionConflictDto[]) => void;
  refreshExtensionConflicts: () => Promise<void>;
  subscribeToProject: (projectPath: string) => Promise<UnlistenFn>;
  getProjectSessions: (projectPath: string | null) => Record<string, LspSessionState>;
  /**
   * On project activation: detect profile, soft-warm primary language
   * (binary check + codemirror preload). Does not spawn servers.
   */
  onProjectActivated: (projectPath: string) => Promise<void>;
}

/**
 * 诊断切片的唯一写路径（D3 单写点）：按 projectPath 展开，逐个 uri 整体替换。
 * `setProjectDiagnostics` / `setProjectDiagnosticsBatch` 共用 —— 突发合并与单条
 * 推送走同一语义，展开逻辑只此一份。
 */
function patchDiagnosticsByProject(
  prev: Record<string, Record<string, LspDiagnostic[]>>,
  projectPath: string,
  entries: Array<[string, LspDiagnostic[]]>,
): Record<string, Record<string, LspDiagnostic[]>> {
  return {
    ...prev,
    [projectPath]: {
      ...(prev[projectPath] ?? {}),
      ...Object.fromEntries(entries),
    },
  };
}

export const useLspStore = create<LspStoreState>((set, get) => ({
  sessions: {},
  profiles: {},
  extensionConflicts: [],
  installProgress: null,
  diagnosticsByProject: {},
  problemsPanelOpen: false,
  isDefinitionJumping: false,

  setProblemsPanelOpen: (open) => {
    set({ problemsPanelOpen: open });
  },

  toggleProblemsPanel: () => {
    set((prev) => ({ problemsPanelOpen: !prev.problemsPanelOpen }));
  },

  setProjectDiagnostics: (projectPath, uri, diagnostics) => {
    set((prev) => ({
      diagnosticsByProject: patchDiagnosticsByProject(prev.diagnosticsByProject, projectPath, [
        [uri, diagnostics],
      ]),
    }));
  },

  setProjectDiagnosticsBatch: (projectPath, entries) => {
    if (entries.length === 0) return;
    set((prev) => ({
      diagnosticsByProject: patchDiagnosticsByProject(
        prev.diagnosticsByProject,
        projectPath,
        entries,
      ),
    }));
  },

  clearProjectDiagnostics: (projectPath) => {
    set((prev) => {
      if (!prev.diagnosticsByProject[projectPath]) return prev;
      const next = { ...prev.diagnosticsByProject };
      delete next[projectPath];
      return { diagnosticsByProject: next };
    });
  },

  setInstallProgress: (progress) => {
    set({ installProgress: progress });
  },

  setDefinitionJumping: (jumping) => {
    set({ isDefinitionJumping: jumping });
  },
  progressTokens: {},

  addProgressToken: (projectPath, languageId, token) => {
    set((prev) => {
      const langTokens = prev.progressTokens[projectPath]?.[languageId] ?? [];
      if (langTokens.includes(token)) return prev;
      return {
        progressTokens: {
          ...prev.progressTokens,
          [projectPath]: {
            ...(prev.progressTokens[projectPath] ?? {}),
            [languageId]: [...langTokens, token],
          },
        },
      };
    });
  },

  removeProgressToken: (projectPath, languageId, token) => {
    set((prev) => ({
      progressTokens: {
        ...prev.progressTokens,
        [projectPath]: {
          ...(prev.progressTokens[projectPath] ?? {}),
          [languageId]: (prev.progressTokens[projectPath]?.[languageId] ?? []).filter(
            (t) => t !== token,
          ),
        },
      },
    }));
  },

  clearProgressTokens: (projectPath, languageId) => {
    set((prev) => {
      if ((prev.progressTokens[projectPath]?.[languageId] ?? []).length === 0) return prev;
      return {
        progressTokens: {
          ...prev.progressTokens,
          [projectPath]: {
            ...(prev.progressTokens[projectPath] ?? {}),
            [languageId]: [],
          },
        },
      };
    });
  },

  setSessionState: (projectPath, languageId, state) => {
    set((prev) => ({
      sessions: {
        ...prev.sessions,
        [projectPath]: {
          ...(prev.sessions[projectPath] ?? {}),
          [languageId]: {
            languageId,
            serverName:
              state.serverName ?? prev.sessions[projectPath]?.[languageId]?.serverName ?? '',
            status:
              (state.status as LspSessionState['status']) ??
              prev.sessions[projectPath]?.[languageId]?.status ??
              'starting',
            statusMessage: state.statusMessage,
            progressPct: state.progressPct,
          },
        },
      },
    }));
  },

  removeSession: (projectPath, languageId) => {
    set((prev) => {
      const projectSessions = prev.sessions[projectPath];
      if (!projectSessions) return prev;
      const next = { ...projectSessions };
      delete next[languageId];
      return {
        sessions: {
          ...prev.sessions,
          [projectPath]: next,
        },
      };
    });
  },

  setProfile: (profile) => {
    set((prev) => ({
      profiles: {
        ...prev.profiles,
        [profile.projectPath]: profile,
      },
    }));
  },

  setExtensionConflicts: (conflicts) => {
    set({ extensionConflicts: conflicts });
  },

  refreshExtensionConflicts: async () => {
    try {
      const conflicts = await lspGetExtensionConflicts();
      set({ extensionConflicts: conflicts });
    } catch {
      // non-fatal
    }
  },

  subscribeToProject: async (projectPath) => {
    // P1 突发收敛：jdtls 初次构建短时对数百文件逐个 publish，N 次直写会触发
    // N 次订阅通知 → 面板 N 次全量重建。待处理表 + microtask 单次 flush，
    // 把同 tick 突发压成 1 次 set（AC1 ≤ 3）。flush 仍经单写点语义：
    // 每个 uri 整体替换，不做数组合并。
    const pendingDiag = new Map<string, LspDiagnostic[]>();
    let diagFlushScheduled = false;
    const flushPendingDiag = () => {
      if (pendingDiag.size === 0) {
        diagFlushScheduled = false;
        return;
      }
      const entries = Array.from(pendingDiag.entries());
      pendingDiag.clear();
      diagFlushScheduled = false;
      // 单次 set 整体替换本次突发涉及的全部 uri（其余 uri 引用不变，
      // 行 memo 化 P3 依赖该引用稳定性）。写路径收敛到 store action，
      // 与 setProjectDiagnostics 同一单写点（D3），不在订阅闭包内平铺。
      get().setProjectDiagnosticsBatch(projectPath, entries);
    };
    const scheduleDiagFlush = () => {
      if (diagFlushScheduled) return;
      diagFlushScheduled = true;
      queueMicrotask(flushPendingDiag);
    };

    const eventName = `${LSP_SESSION_EVENT_PREFIX}${projectPath}`;
    const unlistenSession = await listen<LspSessionStatusEventPayload>(eventName, (event) => {
      const { languageId, status, message, progressPct } = event.payload;
      const store = get();
      if (NEW_SESSION_STATUS[status]) {
        // 新会话 token 空间 fresh：清掉上个会话残留 token，防 busy 残留 wedge。
        store.clearProgressTokens(projectPath, languageId);
      }
      if (NEW_SESSION_STATUS[status] || TERMINAL_STATUS[status]) {
        // 会话边界（新会话起点 / 终态）→ 上一会话的诊断整体失效，清该 projectPath 键
        // （design.md M1 错误矩阵；诊断事件无 languageId，按项目粒度清除）。
        // 同步丢弃待 flush 的旧会话缓冲，否则 microtask 会把陈旧诊断写回来。
        pendingDiag.clear();
        store.clearProjectDiagnostics(projectPath);
      }
      if (
        status === 'ready' &&
        (store.progressTokens[projectPath]?.[languageId] ?? []).length > 0
      ) {
        // 长导入进行中：短任务 end 触发的 ready 不得覆盖 busy，视为 indexing。
        store.setSessionState(projectPath, languageId, {
          status: 'indexing',
          statusMessage: message,
          progressPct,
        });
        return;
      }
      store.setSessionState(projectPath, languageId, {
        status: status as LspSessionState['status'],
        statusMessage: message,
        progressPct,
      });
    });

    const unlistenProgress = await listen<LspProgressEventPayload>(
      `${LSP_PROGRESS_EVENT_PREFIX}${projectPath}`,
      (event) => {
        const { languageId, token, kind, message, percentage } = event.payload;
        const store = get();
        if (kind === 'begin') {
          store.addProgressToken(projectPath, languageId, token);
          const current = store.sessions[projectPath]?.[languageId]?.status;
          if (current != null && !BUSY_STATUS[current]) {
            store.setSessionState(projectPath, languageId, { status: 'indexing' });
          }
        } else if (kind === 'report') {
          store.setSessionState(projectPath, languageId, {
            progressPct: percentage ?? undefined,
            ...(message != null ? { statusMessage: message } : {}),
          });
        } else if (kind === 'end') {
          store.removeProgressToken(projectPath, languageId, token);
          const remaining = get().progressTokens[projectPath]?.[languageId] ?? [];
          if (
            remaining.length === 0 &&
            store.sessions[projectPath]?.[languageId]?.status === 'indexing'
          ) {
            store.setSessionState(projectPath, languageId, { status: 'ready' });
          }
        }
      },
    );

    const unlistenProfile = await listen<ProjectLanguageProfile>(LSP_PROFILE_EVENT, (event) => {
      if (event.payload.projectPath === projectPath) {
        get().setProfile(event.payload);
      }
    });

    // 诊断直采（D3 单写点）：publishDiagnostics 语义 = 整体替换该 uri。
    // 注册/释放随 subscribeToProject 生命周期（bridge 对 active project 对称调用）。
    // 突发收敛：先入待处理表，microtask 批量单次 set（R1）。
    const unlistenDiag = await listen<LspDiagnosticsEvent>(
      `${LSP_DIAG_EVENT_PREFIX}${projectPath}`,
      (event) => {
        const payload = event.payload as LspDiagnosticsEvent | null | undefined;
        // 解析容错（错误矩阵）：单事件损坏整体丢弃 + warn，不污染状态。
        if (
          !payload ||
          typeof payload.uri !== 'string' ||
          payload.uri === '' ||
          !Array.isArray(payload.diagnostics)
        ) {
          console.warn('[LSP] malformed diagnostics event discarded:', event.payload);
          return;
        }
        pendingDiag.set(payload.uri, payload.diagnostics);
        scheduleDiagFlush();
      },
    );

    return () => {
      // 卸载兜底：同步 flush 残留突发（防丢尾），再对称释放监听。
      flushPendingDiag();
      safeUnlisten(unlistenSession)();
      safeUnlisten(unlistenProgress)();
      safeUnlisten(unlistenProfile)();
      safeUnlisten(unlistenDiag)();
    };
  },

  getProjectSessions: (projectPath) => {
    if (!projectPath) return {};
    return get().sessions[projectPath] ?? {};
  },

  onProjectActivated: async (projectPath) => {
    try {
      // Keep frontend extension router in sync with custom servers
      try {
        const map = await lspGetExtensionMap();
        applyBackendExtensionMap(
          map.map((e) => ({
            extension: e.extension,
            languageId: e.languageId,
            serverName: e.serverName,
            isCustom: e.isCustom,
          })),
        );
      } catch {
        // non-fatal
      }

      void get().refreshExtensionConflicts();

      // Backend also runs activate_project from set_active_project; calling again
      // is idempotent (re-detect + cancel deactivate + emit).
      const profile = await lspDetectProjectProfile(projectPath);
      get().setProfile(profile);

      const primary = profile.primary;
      if (!primary) return;

      // Soft warm: codemirror language chunk
      const sample = LANG_PRELOAD_FILE[primary.languageId];
      if (sample) {
        preloadLanguageExtension(sample);
      }

      // Soft warm: binary presence in this project's environment (no spawn)
      const installed = await lspCheckServerInstalled(primary.languageId, projectPath);
      if (!installed) {
        console.info(
          `[LSP] Soft-warm: ${primary.serverName} not on PATH for ${primary.languageId} (project=${projectPath})`,
        );
      }
    } catch (e) {
      console.warn('[LSP] onProjectActivated failed:', e);
    }
  },
}));
