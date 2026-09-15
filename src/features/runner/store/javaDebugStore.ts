/**
 * Java 专属调试会话状态与动作（**语言会话记忆**，方案 B 阶段 4）。
 *
 * 从通用 `debugStore` 迁出：这些字段/动作只服务 Java（`backendLabel` / `zeroTestReported` /
 * `hostFallbackProjects` + attach 与 JDTLS 两条启动路径），留在通用 store 里会让「通用层不认识
 * 任何语言」这条约束失效（且 `startJavaAttach` 里的 `type: 'java'` 就是护栏 1 的违规点）。
 *
 * 通用会话/面板/console 仍归 [`useDebugStore`]（唯一写入方），本 store 通过它的公开方法落库
 * （`startWithConfig` / `attachSession` / `setPanelError` / `resetSession`），不直接改其 state
 * —— 以保留面板互斥等既有语义。
 */
import { create } from 'zustand';

import { useNotificationStore } from '@/shared/store/notificationStore';

import { debugJavaAttach, debugJavaStart } from '../api/debugApi';
import type {
  DapSessionInfo,
  JavaBackendLabel,
  JavaDebugStartResult,
  JavaJdtlsTarget,
  LaunchConfig,
} from '../types';

import { useDebugStore } from './debugStore';

interface JavaDebugState {
  /**
   * 当前 Java 调试后端标注（`jdtls` / `host` / `host (fallback)`）；非 Java 会话为 `null`。
   *
   * 由调用方在启动时设置（B' / A / 用户确认降级），供 DebugPanel 副标题与「求值是否可用」的 UI
   * 判定使用 —— **不自动换引擎**，这里只反映**实际**走了哪条路。
   */
  backendLabel: JavaBackendLabel | null;
  /** 本次会话是否已因「零用例」报错过（防重复终止 / 重复通知）。 */
  zeroTestReported: boolean;
  /**
   * 用户**显式确认**过降级到 host 的项目（仅内存 = 仅本项目会话）。
   *
   * 记住它可避免每次点 Debug 都被问一次；「重试 JDTLS」清除该记忆。刻意**不写全局配置**
   * （design §2.5：一次临时选择不应固化成长期配置）。
   */
  hostFallbackProjects: string[];
  /** 设置后端标注（`null` 清除）。 */
  setBackendLabel: (label: JavaBackendLabel | null) => void;
  /** 记住/清除「本项目已确认降级到 host」。 */
  markHostFallback: (projectId: string) => void;
  clearHostFallback: (projectId: string) => void;
  /** 本项目是否已确认降级（供 dispatch 跳过 B' 探测）。 */
  isHostFallback: (projectId: string) => boolean;
  /** 新会话开始：复位本会话的记忆（标注 + 零命中闩锁）。 */
  resetSession: () => void;
  /** 「零用例即终止」的闩锁（同一会话只报一次）。 */
  markZeroTestReported: () => void;
  /**
   * Java attach-first（J3）：后端单条命令 spawn 测试 JVM（jdwp suspend=y）→ 解析端口 →
   * JavaAdapter attach 会话。`command` 为 `buildJavaDebugCommand` 产物；`classpath` 供 host
   * 解析第三方库 / JDK 源码。
   */
  startJavaAttach: (
    projectId: string,
    command: string,
    cwd: string,
    testName: string,
    classpath: string[],
  ) => Promise<void>;
  /** B'（JDTLS 后端）：能力探测 → 直连 JDTLS 内 DAP 端口 → `launch`（三态原样返回）。 */
  startJavaDebug: (projectId: string, target: JavaJdtlsTarget) => Promise<JavaDebugStartResult>;
}

/** info/error 级通知（warming 需要非错误提示）。 */
function notify(type: 'info' | 'error', message: string) {
  useNotificationStore
    .getState()
    .addNotification({ type: type === 'info' ? 'info' : 'error', title: 'Debug', message });
}

export const useJavaDebugStore = create<JavaDebugState>((set, get) => ({
  backendLabel: null,
  zeroTestReported: false,
  hostFallbackProjects: [],

  setBackendLabel: (label) => set({ backendLabel: label }),

  markHostFallback: (projectId) =>
    set((state) => ({
      hostFallbackProjects: state.hostFallbackProjects.includes(projectId)
        ? state.hostFallbackProjects
        : [...state.hostFallbackProjects, projectId],
    })),

  clearHostFallback: (projectId) =>
    set((state) => ({
      hostFallbackProjects: state.hostFallbackProjects.filter((id) => id !== projectId),
    })),

  isHostFallback: (projectId) => get().hostFallbackProjects.includes(projectId),

  resetSession: () => set({ backendLabel: null, zeroTestReported: false }),

  markZeroTestReported: () => set({ zeroTestReported: true }),

  startJavaAttach: async (projectId, command, cwd, testName, classpath) => {
    const debug = useDebugStore.getState();
    // 进入新会话前复位（与 `start` / `startWithConfig` / `startJavaDebug` 一致），
    // 随后回显真实执行命令（reset 之后推，否则被清空；用户可复制复现排查）。
    debug.resetSession();
    get().resetSession();
    debug.pushConsole('sys', `$ ${command}`);
    const config: LaunchConfig = {
      name: `Debug test: ${testName}`,
      type: 'java',
      request: 'attach',
      cwd,
      stopOnEntry: false,
    };
    // `reset: false`：本方法已自行复位（顺序见上），避免 store 再次清空刚回显的命令。
    await debug.startWithConfig(projectId, config, {
      reset: false,
      starter: () => debugJavaAttach(projectId, command, cwd, testName, classpath),
    });
  },

  startJavaDebug: async (projectId, target) => {
    const debug = useDebugStore.getState();
    // 与其它入口一致：进入新会话前重置本会话状态。漏掉它会有两个实证后果：`zeroTestReported`
    // 永不复位（「0 用例即终止」的不变式只生效一次）、Console 跨次累积。重置必须在 pushConsole
    // 之前，否则回显被清掉。
    debug.resetSession();
    get().resetSession();
    debug.pushConsole('sys', `JDTLS backend: probing ${target.probeClass} …`);
    const result = await debugJavaStart(projectId, target);
    if (result.kind === 'session') {
      const session: DapSessionInfo = result.session;
      debug.attachSession(session);
      set({ backendLabel: 'jdtls' });
      debug.pushConsole('sys', `Started: ${session.configName} (${session.status})`);
      return result;
    }
    if (result.kind === 'warming') {
      // 探测**立即返回**（无挂起调用 → 无可取消的 loading）；重试 = 再点一次 Debug。
      const msg = `JDTLS backend is warming up: ${result.detail}. Click Debug again to retry.`;
      notify('info', msg);
      debug.pushConsole('sys', msg);
      debug.openPanel('console');
      return result;
    }
    // unavailable：报错 + 显式切换入口（绝不自动换成 host）。
    const hint = result.staticallyDetectable
      ? ' Switch to the host backend (dap.javaBackend = "host") to debug anyway (limited: no expression evaluation).'
      : ' Retry once the Java language server is ready, or switch to the host backend (dap.javaBackend = "host").';
    const msg = `${result.message}${hint}`;
    debug.setPanelError(msg);
    debug.pushConsole('err', msg);
    notify('error', msg);
    return result;
  },
}));
