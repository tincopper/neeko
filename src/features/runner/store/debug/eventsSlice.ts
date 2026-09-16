import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { DAP_EVENT, DAP_SESSION_STATUS_EVENT } from '@/shared/events';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';
import { stripAnsi } from '@/shared/utils/stripAnsi';

import { withStopLocation } from '../../stopLocation';
import type { ConsoleLine, DapEventPayload, DapSessionInfo } from '../../types';
import { isCodelldbNoise } from '../../utils/consoleFilter';
import { languageHooks } from '../languageHooks';

import { CLEAR_EXPANSION, endedSessionPatch, notifyError } from './shared';
import type { DebugEventsSlice, DebugSliceCreator } from './types';

/**
 * DAP 事件 → 各 slice 的投影（本 slice 自身无 state，只做适配）。
 *
 * 两类来源：会话事件流 `DAP_EVENT`、会话状态流 `DAP_SESSION_STATUS_EVENT`。
 * 不变式：
 * - 事件带 `sessionId` 时先按身份过滤，避免旧会话的迟到事件污染新会话。
 * - `continued` / `terminated` 必须清空变量展开缓存与停止位置（引用号与黄线都随上下文失效）。
 * - 输出行的「是否必须终止会话」判定归**语言模块**（`debugHooks.inspectConsoleLine`）：
 *   首个非空判定生效，通用层不持有任何语言闩锁。
 */
export const createEventsSlice: DebugSliceCreator<DebugEventsSlice> = (set, get) => ({
  subscribeEvents: async () => {
    const unsubs: UnlistenFn[] = [];
    unsubs.push(
      await listen<DapEventPayload>(DAP_EVENT, (event) => {
        const { kind, body, sessionId } = event.payload;
        const session = get().session;
        if (session && session.sessionId && session.sessionId !== sessionId) return;

        if (kind === 'stopped') {
          if (session?.sessionId && session.sessionId !== sessionId) return;
          // Merge status even if start() hasn't set session yet (use payload ids).
          const base =
            session?.sessionId === sessionId
              ? session
              : (session ?? {
                  sessionId,
                  projectId: event.payload.projectId,
                  projectPath: '',
                  configName: '',
                  status: 'stopped',
                });
          set({
            session: { ...base, sessionId, status: 'stopped' },
            panelOpen: true,
            panelTab: 'session',
          });
          // No Debug Console spam for stop/step — toolbar + Call Stack already show state.
          void get().refreshStackAndVars();
        } else if (kind === 'continued') {
          set({
            session: session ? { ...session, status: 'running' } : session,
            // 运行中不存在有效停点：清位置（序号 +1，编辑器据此释放光标 + 撤黄线）并作废代际。
            ...withStopLocation(get(), null),
            generation: null,
            ...CLEAR_EXPANSION, // references from the previous stop are stale
          });
        } else if (kind === 'terminated') {
          // Always clear stack/vars (status may already be terminated via dap-session-status).
          const alreadyEnded = session?.status === 'terminated';
          set({
            ...endedSessionPatch(session, get()),
            panelOpen: true,
            panelTab: 'console',
          });
          if (!alreadyEnded) {
            get().pushConsole('sys', 'Session terminated');
          }
        } else if (kind === 'output') {
          const output = body as { output?: string; category?: string };
          const raw = output.output ?? '';
          let text = raw.replace(/\n$/, '');
          // codelldb / libtest 输出带 ANSI 颜色（`\x1b[32m`…`\x1b[0m`、字符集
          // `\x1b(B`）——DebugPanel console 是纯文本，原样显示即乱码，先剥。
          text = stripAnsi(text);
          // 过滤调试台的纯提示噪音（codelldb 启动 banner；VSCode DEBUG CONSOLE
          // 也有，但对普通用户无信息量）。`Starting:`/`Launched process` 保留。
          if (isCodelldbNoise(text)) {
            return;
          }
          if (text) {
            const cat = output.category ?? 'stdout';
            const lineKind: ConsoleLine['kind'] =
              cat === 'stderr' ? 'err' : cat === 'console' ? 'sys' : 'out';
            const parts = text.split('\n');
            for (const part of parts) {
              get().pushConsole(lineKind, part);
            }
            // 会话输出不变式：语言模块可声明「这种输出必须终止会话」（Java：Console Launcher
            // 汇总 0 用例 → 静默会话会让断点永不命中）。逐行询问已注册语言，首个非空判定生效。
            const verdict = parts
              .flatMap((part) =>
                (languageHooks()?.all() ?? []).map((m) => m.debugHooks?.inspectConsoleLine?.(part)),
              )
              .find((v) => v != null);
            if (verdict) {
              // 闩锁（「只报一次」）归**语言自己的 store**：本判定由语言 hook 给出，
              // 它已在返回判定前沿自己的闩锁，通用层不再持有该状态。
              get().pushConsole('err', verdict.message);
              notifyError(verdict.message);
              void get().stop();
            }
            // Program prints (and errors) should be visible in Debug Console.
            if (cat === 'stdout' || cat === 'stderr') {
              set({ panelOpen: true, panelTab: 'console' });
            }
          }
        } else if (kind === 'session' && session) {
          const status = (body as { status?: string })?.status;
          if (status) {
            set({ session: { ...session, status } });
          }
        }
      }),
    );
    unsubs.push(
      await listen<DapSessionInfo>(DAP_SESSION_STATUS_EVENT, (event) => {
        const info = event.payload;
        const cur = get().session;
        if (info.status === 'terminated' || info.status === 'ended') {
          // 死亡通知不许创建会话（评审 P6），且 sessionId 不匹配的死亡通知必须忽略
          // （架构审查 Major：rerun 停旧起新时旧会话 terminated 晚到会覆盖新会话）。
          // 镜像 DAP_EVENT 的 identity filter（见上 `session.sessionId !== sessionId`）。
          if (!cur || cur.sessionId !== info.sessionId) return;
          set({
            ...endedSessionPatch(
              { ...cur, ...info },
              get(),
              info.statusMessage ?? 'Session terminated',
            ),
            panelOpen: true,
            panelTab: 'console',
          });
          return;
        }
        if (cur && cur.sessionId === info.sessionId) {
          set({ session: info });
        } else if (!cur) {
          set({ session: info, panelOpen: true, panelTab: 'session' });
        }
      }),
    );
    return () => {
      for (const u of unsubs) safeUnlisten(u)();
    };
  },
});
