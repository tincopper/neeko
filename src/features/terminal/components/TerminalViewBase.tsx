import { emit, listen } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { resolveAgent } from '@/shared/store/agentStore';
import { observeContainerSize } from '@/shared/utils/containerObserver';
import { createDrainTransportScheduler } from '@/shared/utils/drainLoop';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';
import { createScrollIdleTag, type ScrollIdleTag } from '@/shared/utils/scrollAutoHide';
import {
  applyRenderer,
  buildTerminalOptions,
  healWebglRenderer,
  resumeWebglRenderer,
  suspendWebglRenderer,
} from '@/shared/utils/terminal';
import { terminalClosedEvent, terminalInputEvent } from '@/shared/utils/terminalEvents';
import { setupTerminalInput } from '@/shared/utils/terminalInput';
import {
  buildMonoStack,
  ensureTerminalFontsReady,
  resolveTerminalLineHeight,
} from '@/shared/utils/typography';

import { drainTerminal, drainTerminalWait } from '../api/terminalApi';
import type { TerminalStrategy, CacheEntry } from '../strategies/types';
import { createFitScheduler, type FitScheduler } from '../utils/fitScheduler';
import { createTerminalTitleSync, type TerminalTitleSync } from '../utils/terminalTitle';

import { refreshTerminalEntry } from './terminalCache';

/**
 * Write 流水线哨兵：最后一次 write 下发后超过该时长仍无 parse 回调，
 * 判定渲染流水线疑似卡死（WebContent 忙死/渲染器 wedge），重建终端自愈。
 * 参照 orca terminal-write-pipeline-health 的 stall-watch 设计。
 */
const TERMINAL_WRITE_STALL_MS = 12000;

/**
 * 哨兵重建冷却闸：同一 cacheKey 两次哨兵重建的最小间隔。防止「重建后再次
 * 触发 → 无限重建风暴」（每次重建含 WebGL 上下文创建，风暴会拖死共享
 * WebContent 的渲染管线 —— 全部 tab 一起黑屏的放大器）。
 */
const TERMINAL_REBUILD_COOLDOWN_MS = 30000;

interface TerminalViewBaseProps {
  strategy: TerminalStrategy;
  tabAgentId: string | null;
  activeTabId: string | null;
  taskCommand?: string | null;
  taskConfigId?: string | null;
  taskRebuildKey?: number;
  /**
   * PTY 创建成功后回调一次，参数是后端铸造的 session id。
   *
   * 它写进 `TerminalTabData.ptySessionId` —— 侧栏会话行与 tab 之间的**唯一映射键**
   * （侧栏来自注册表，不依赖打开的 tab）。终点由上层决定（本组件不碰 editor store）。
   */
  onSessionCreated?: (sessionId: string) => void;
  /**
   * 终端自己声明的标题（xterm OSC 0/2 → `term.onTitleChange`）回调。
   *
   * 只在本组件内做「同一会话值不变不发」的去重（CLI 的 spinner 帧会反复发同一个
   * 标题），发送与升级规则归上层 / 后端。PTY 创建完成前会话 id 还不存在，那段时间
   * 的标题不发送也不记基线 —— 第一个真实标题会在创建完成后补发。
   */
  onSessionTitleChange?: (sessionId: string, title: string) => void;
}

export default React.memo(function TerminalViewBase({
  strategy,
  tabAgentId,
  taskCommand,
  taskConfigId,
  taskRebuildKey = 0,
  onSessionCreated,
  onSessionTitleChange,
}: TerminalViewBaseProps) {
  const { cacheKey, fontSize, fontFamily: fontFamilyProp } = strategy;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const currentTermRef = useRef<Terminal | null>(null);
  const strategyRef = useRef(strategy);
  strategyRef.current = strategy;
  const [rebuildCount, setRebuildCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // 滚动空闲标记：停止滚动 3s 后给壳层挂 `.scroll-idle`，让 xterm 自绘滚动条淡出
  //（xterm 自己只在指针移出滚动区时隐藏，指针停在终端里就永远可见）。
  const scrollIdleRef = useRef<ScrollIdleTag | null>(null);
  useEffect(() => {
    const tag = createScrollIdleTag();
    scrollIdleRef.current = tag;
    return () => {
      tag.dispose();
      scrollIdleRef.current = null;
    };
  }, []);
  // 调度器句柄：**按 effect 实例归属**（每 cacheKey 一份），绝不挂组件级 ref。
  // 挂组件级会让去重基线跨 tab 存活——上一个 tab 的 lastFit 尺寸被新 tab 继承，
  // 新 tab 的首次 PTY 同步被早退闸吃掉（格式混乱的根因，见 fitScheduler.ts 不变式）。
  const schedulerRef = useRef<FitScheduler | null>(null);
  // 哨兵定时器句柄：提升到组件作用域，effect cleanup 必须清除 —— 否则卸载/
  // 重建后僵尸定时器仍会在废弃闭包上触发 rebuildTerminal（重建风暴源头之一）。
  const stallTimerRef = useRef<number | undefined>(undefined);
  // 哨兵重建冷却时间戳：跨 effect 重跑存活（rebuild 会触发 effect 重入，
  // 局部变量冷却会被重置导致风暴）。
  const lastRebuildAtRef = useRef(0);

  /** 统一 resize 入口：由 fitScheduler 承担 RAF 合帧 / trailing / 去重 / pending 重试。 */
  const scheduleFit = useCallback(() => {
    schedulerRef.current?.scheduleFit();
  }, []);

  const handleScrollToBottom = useCallback(() => {
    const term = currentTermRef.current;
    if (!term) return;
    term.scrollToBottom();
    term.focus();
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const {
      cache,
      rebuildCallbacks,
      wrapperRefs,
      fontSize: fontSizeVal,
      fontFamily: fontFamilyVal,
      gpuAccel: gpuAccelVal,
      setupFileLinks: setupFileLinksVal,
      createSession: createSessionVal,
      agentDelayMs: agentDelayMsVal,
      onSessionReady: onSessionReadyVal,
      outputFilter: outputFilterVal,
    } = strategyRef.current;

    currentKeyRef.current = cacheKey;
    setReady(false);

    // 每个 cacheKey 一份调度器实例：去重基线随实例生死而重置 —— 切 tab 必然
    // 新建（从零收敛，不可能继承上一个终端的同步历史）。这是「去重状态按
    // 终端归属」这一不变式的落地处。
    schedulerRef.current = createFitScheduler({
      getEntry: () => {
        const key = currentKeyRef.current;
        if (!key) return null;
        return strategyRef.current.cache.get(key) ?? null;
      },
      resize: (sessionId, cols, rows) => strategyRef.current.resize(sessionId, cols, rows),
    });

    rebuildCallbacks.set(cacheKey, () => {
      if (currentKeyRef.current === cacheKey) setRebuildCount((c) => c + 1);
    });
    if (wrapperRef.current) {
      wrapperRefs.set(cacheKey, wrapperRef.current);
    }

    const attach = (entry: CacheEntry) => {
      if (!wrapper.contains(entry.element)) {
        wrapper.appendChild(entry.element);
      }
      // attach 触发源（2）：统一经 scheduleFit 合帧，避免与 RO 竞态
      scheduleFit();
      // WebGL 状态恢复（借鉴 orca pane-webgl suspend/resume 裁剪版）：
      //  - 终端在后台被 suspend（tab 切走时 cleanup dispose 了 addon 释放
      //    GPU 配额）→ resume 重建渲染器 + 恢复链（内部自判 suspended，
      //    非 suspend 态同步 no-op，不受 heal 节流约束）；
      //  - 终端始终在页面（从未离开）→ heal 图集（30s 节流），防 DOM 移动
      //    后纹理失同步乱码（中文断裂成方块）。suspend 后 addon 已清，
      //    heal 自然 no-op，无重复动作。
      void resumeWebglRenderer(entry.term);
      healWebglRenderer(entry.term);
      requestAnimationFrame(() => {
        if (currentKeyRef.current !== cacheKey) return;
        entry.term.focus();
      });
    };

    const detachAll = () => {
      while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
    };

    detachAll();

    // Task rebuild guard: destroy stale task cache when rebuildKey bumps
    if (taskCommand && taskRebuildKey > 0) {
      const stale = cache.get(cacheKey);
      if (stale && stale.sessionId === null) {
        cache.delete(cacheKey);
      }
    }

    let scrollDisposable: { dispose: () => void } | undefined;
    // 标题回传（OSC 0/2）：订阅按 **effect** 生命周期归属 —— `Terminal` 实例跨 mount
    // 存活（终端缓存），监听器不存活；不重挂就会在 tab 切走后留下仍在发 IPC 的闭包。
    let titleSync: TerminalTitleSync | null = null;
    const attachTitleSync = (term: Terminal, getSessionId: () => string | null) => {
      if (!onSessionTitleChange) return;
      titleSync?.dispose();
      titleSync = createTerminalTitleSync({
        term,
        getSessionId,
        publish: onSessionTitleChange,
      });
    };
    // 字体门闩等待期间的卸载标记：cleanup 置 true，async 创建续体据此放弃
    // （await 是宏任务间隙，React 卸载/rebuild 可在此期间发生 → 防幽灵终端
    // 在已 detach 的 wrapper 上 open + 覆盖 cache entry）。
    let cancelled = false;

    const existingCache = cache.get(cacheKey);
    if (existingCache) {
      setReady(!!existingCache.sessionId);
      attach(existingCache);
      currentTermRef.current = existingCache.term;
      scrollDisposable = existingCache.term.onScroll(() => {
        setIsAtBottom(
          existingCache.term.buffer.active.viewportY >= existingCache.term.buffer.active.baseY,
        );
        scrollIdleRef.current?.reveal(wrapperRef.current);
      });
      // 复用的终端：session id 在 entry 上（未创建完成就 read 到 null，再由 emit 时的
      // 实时读取拿到 —— 阅读点每次读 `entry.sessionId` 当前值，不存快照）。
      attachTitleSync(existingCache.term, () => existingCache.sessionId);
    } else {
      const element = document.createElement('div');
      element.style.width = '100%';
      element.style.height = '100%';

      const term = new Terminal(
        buildTerminalOptions({
          terminalFontSize: fontSizeVal,
          monoFontFamily: fontFamilyVal,
        }),
      );
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      const unicode11 = new Unicode11Addon();
      term.loadAddon(unicode11);
      term.unicode.activeVersion = '11';

      // P0-A 字体门闩（根治字体加载竞态，见 shared/utils/typography）：
      // 打包 mono 字体就绪前 open() 会令 xterm 按 fallback 字形测量，且 WebGL
      // 图集首帧把 fallback 字形锁死进纹理缓存 —— 表现即「开 GPU 后 TUI 渲染
      // 不精细/乱码」（Canvas 每帧重绘自愈故无此现象，orca 用系统 SF Mono 无
      // 加载窗口故同样 WebGL 却精细）。gate 通过才 append + open，首帧即真实
      // 字形；等待期间组件卸载/rebuild（cancelled）则放弃本次创建。
      void (async () => {
        await ensureTerminalFontsReady(buildMonoStack(fontFamilyVal), fontSizeVal);
        if (cancelled) return;

        wrapper.appendChild(element);
        term.open(element);
        // 渲染器：确定性 RendererPlan 选型（启动期探测 + 预热，见 shared/utils/terminal）。
        // GPU 配置开启且 webgl 可用 → WebGL，否则 Canvas（xterm 6 默认 DOM renderer
        // 在 TUI 高频重绘下内存爆炸）。
        void applyRenderer(term, gpuAccelVal);
        if (setupFileLinksVal) setupFileLinksVal(term);
        fitAddon.fit();

        currentTermRef.current = term;
        scrollDisposable = term.onScroll(() => {
          setIsAtBottom(term.buffer.active.viewportY >= term.buffer.active.baseY);
          scrollIdleRef.current?.reveal(wrapperRef.current);
        });

        const entry = {
          term,
          fitAddon,
          element,
          sessionId: null as string | null,
          unlisten: null as (() => void) | null,
          inputController: null as ReturnType<typeof setupTerminalInput> | null,
        };
        cache.set(cacheKey, entry);

        try {
          const sessionId = await createSessionVal(term.cols, term.rows, {
            command: taskCommand ?? undefined,
            configId: taskConfigId ?? undefined,
            // agent 身份在创建时就已知（tab 上带着）—— 显式下发，不从命令行字符串反推
            agentId: tabAgentId,
          });

          if (currentKeyRef.current !== cacheKey) return;
          entry.sessionId = sessionId;
          setReady(true);
          onSessionReadyVal?.();
          onSessionCreated?.(sessionId);

          // 标题订阅在 session id 就绪后挂上：此前收到的 OSC 标题无处归属（不记基线，
          // 于是第一个真实标题一定会补发一次）。
          attachTitleSync(term, () => entry.sessionId);

          // 当 taskCommand 已设置时（如 resume），跳过 auto-launch
          if (tabAgentId && !taskCommand) {
            setTimeout(async () => {
              if (!entry.sessionId) return;
              // 命令的唯一来源是 agent 缓存（后端 `AgentManager` 的快照）。
              // 用 `resolveAgent`（未加载则触发一次加载再取），而不是只在
              // 缓存里找 —— 启动期会话恢复可能早于 preload 完成，只查缓存会
              // 让用户得到一个空终端。
              const agent = await resolveAgent(tabAgentId);
              if (!agent) {
                console.warn('[Terminal] agent not in cache, skipping auto-launch:', tabAgentId);
                return;
              }
              const cmdStr = [agent.command, ...agent.args].join(' ') + '\r';
              const bytes = Array.from(new TextEncoder().encode(cmdStr));
              // 静默豁免：终端输入，尽力而为，失败无需上报
              emit(terminalInputEvent(entry.sessionId), bytes).catch(() => {});
              // 状态不在这里写：PTY 一旦创建就是 running，注册表（后端）已经是唯一写者
            }, agentDelayMsVal);
          }

          // credit-pull 输出协议（内存治理）：后端把 PTY 输出汇入有界
          // SessionDrain；前端经调度器拉取：draining 期间的新数据记
          // pendingWake 闩锁、门闸早退置 maybePending 残留证据、parse 回调经
          // onWriteDigested 续拉 —— 闭合全部丢失路径（冻结故障回炉，
          // 见任务 design.md §8）。事件队列不再无界积压。
          // 方案 B（去 eval 化）：触发源由 terminal-drain-{id} 事件改为 fetch
          // 拉取 ——macOS 上事件送达 = 每次 evaluateJavaScript，WebKit 无条件
          // 克隆+stringify 完成值导致 WebContent RSS 只增不减；invoke 走
          // custom protocol fetch，零 eval 零克隆。默认 long-poll 挂起式
          // drain（createDrainTransportScheduler），VITE_TERMINAL_DRAIN_POLL=1
          // 时回退 100ms 全局轮询。
          const pendingWrites = { current: 0 };

          const rebuildTerminal = (key: string): void => {
            // 冷却闸：风暴防护。冷却期内放弃本次自愈（下个哨兵周期再试）。
            const now = Date.now();
            if (now - lastRebuildAtRef.current < TERMINAL_REBUILD_COOLDOWN_MS) {
              console.warn('[Terminal] rebuild skipped (cooldown)', key);
              return;
            }
            lastRebuildAtRef.current = now;
            // 按精确键刷新（键在三个物理 Map 中唯一命中其一，不再从 key 猜 env 前缀）。
            refreshTerminalEntry(key);
          };

          const clearStallWatch = () => {
            if (stallTimerRef.current !== undefined) {
              window.clearTimeout(stallTimerRef.current);
              stallTimerRef.current = undefined;
            }
          };

          // 哨兵收紧：仅在「存在未完成 parse 的在途 write」时警戒；parse 有
          // 进展即撤销。避免 rAF/渲染繁忙导致的误报重建风暴。
          const armStallWatch = () => {
            if (pendingWrites.current <= 0) return;
            if (stallTimerRef.current !== undefined) window.clearTimeout(stallTimerRef.current);
            stallTimerRef.current = window.setTimeout(() => {
              stallTimerRef.current = undefined;
              if (pendingWrites.current <= 0) return;
              // 有在途 write 且长时间无 parse 回调 → 渲染流水线疑似卡死
              // （WebContent 忙死/WKWebView wedge）→ 销毁重建终端缓存自愈。
              console.error('[Terminal] write pipeline stalled, rebuilding terminal', sessionId);
              rebuildTerminal(cacheKey);
            }, TERMINAL_WRITE_STALL_MS);
          };

          const writeChunk = (chunk: ArrayBuffer) => {
            const raw = new Uint8Array(chunk);
            const bytes = outputFilterVal ? (outputFilterVal(raw) as Uint8Array) : raw;
            pendingWrites.current += 1;
            try {
              term.write(bytes, () => {
                pendingWrites.current = Math.max(0, pendingWrites.current - 1);
                clearStallWatch();
                scheduler.onWriteDigested();
              });
            } catch {
              // 终端已 dispose（重建竞态）→ 静默释放计数，写入失败无害
              pendingWrites.current = Math.max(0, pendingWrites.current - 1);
              clearStallWatch();
            }
            armStallWatch();
          };

          const scheduler = createDrainTransportScheduler({
            sessionId,
            drain: drainTerminal,
            drainWait: drainTerminalWait,
            write: writeChunk,
            pendingWrites: () => pendingWrites.current,
          });

          // 会话自然退出（shell exit）后后端已移除 drain 条目并 close：
          // 挂起的 drainWait 得 NotFound 自停；dispose 幂等收口，closed 后
          // 无数据可拉，注销绝对安全。
          const rawUnlistenClosed = await listen(terminalClosedEvent(sessionId), () => {
            scheduler.dispose();
          });
          const unlistenClosed = safeUnlisten(rawUnlistenClosed);

          // 调度器注销挂到 entry.unlisten 槽位：terminalCache 销毁/重建统一经
          // entry.unlisten?.() 清理，幂等安全。closed 监听一并收口，避免
          // Tauri 事件注册表残留死闭包。
          entry.unlisten = () => {
            scheduler.dispose();
            unlistenClosed();
          };

          entry.inputController = setupTerminalInput({
            term,
            sendInput: (text: string) => {
              if (!entry.sessionId) return;
              const bytes = Array.from(new TextEncoder().encode(text));
              // 静默豁免：终端输入，尽力而为，失败无需上报
              emit(terminalInputEvent(entry.sessionId), bytes).catch(() => {});
            },
          });
          // session-ready 触发源（3）：统一经 scheduleFit
          scheduleFit();
          requestAnimationFrame(() => {
            if (currentKeyRef.current !== cacheKey) return;
            term.focus();
          });
        } catch (err) {
          if (cancelled || currentKeyRef.current !== cacheKey) return;
          setReady(true);
          term.write(`\x1b[31mFailed to connect: ${err}\x1b[0m\r\n`);
        }
      })();
    }

    // 字体同步（触发源 1）。**必须声明在主 effect 之后** —— scheduleFit 只是
    // schedulerRef.current?.scheduleFit()，而 schedulerRef 由上面的主 effect 创建。
    // React 按声明顺序执行 effect；若本 effect 在前，cacheKey 变化时主 effect 尚未
    // 跑完（新 scheduler 未建），scheduleFit 会打到 null → 字体变更的 resize 静默丢失。
    const syncFont = () => {
      const c = strategyRef.current.cache.get(cacheKey);
      if (!c) return;
      c.term.options.fontSize = strategyRef.current.fontSize;
      c.term.options.fontFamily = buildMonoStack(strategyRef.current.fontFamily);
      c.term.options.lineHeight = resolveTerminalLineHeight(strategyRef.current.fontSize);
      scheduleFit();
    };
    syncFont();

    // ── ResizeObserver 断自激改造 ─────────────────────────────────────
    // 共享 guarded 形态见 shared/utils/containerObserver（原先是本文件手抄的
    // contentRect + rAF 副本，与 TaskConsoleOutput 各一份）：fit() 改写 canvas
    // 尺寸又被 RO 观测到 → 无条件 fit 形成反馈环（WebKit 布局风暴 + Jetsam 实锤）。
    // 统一入口 scheduleFit：
    //   - contentRect 守卫（<1px 忽略）由 containerObserver 承担
    //   - scheduleFit 内：RAF 合帧 + 120ms trailing 兜底 + 已同步去重 + 失败 pending 重试
    // 四触发源（RO/attach/字体/session-ready）均经此入口。
    const containerObserver = observeContainerSize({ onResize: () => scheduleFit() });
    containerObserver.observe(wrapper);

    return () => {
      cancelled = true;
      titleSync?.dispose();
      titleSync = null;
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
      containerObserver.disconnect();
      // 哨兵卫生：清除未决的 stall 定时器，防止僵尸定时器在废弃闭包上触发
      // rebuildTerminal（重建风暴源头之一，任务 design.md §8.1 放大器 B）。
      if (stallTimerRef.current !== undefined) {
        window.clearTimeout(stallTimerRef.current);
        stallTimerRef.current = undefined;
      }
      // WebGL 挂起（tab 切走 / 组件卸载 = orca pane-hide）：dispose addon
      // 释放 GPU 上下文配额（Chromium ~8~16 上限，超限静默逐出最旧 context）。
      // 多 tab 终端累积正是 context-loss 的系统性源头 —— suspend 是「防」而非
      // 「治」。term 缓冲数据完好，下次 mount 的 attach 经 resumeWebglRenderer
      // 重建渲染器。常驻终端（底部 Task Console 等不卸载组件）不会误触。
      // 精确目标：suspend 本 effect 的 cacheKey 条目，而非共享可变 ref
      // （门闩等待期卸载时 currentTermRef 可能仍指旧 term → 错位 dispose；
      // suspend 幂等故此前仅冗余，无风暴风险）。条目不存在（门闩期）则
      // 回退同 key 的 currentTermRef；key 已切换则跳过。
      {
        const staleEntry = strategyRef.current.cache.get(cacheKey);
        const termToSuspend =
          staleEntry?.term ?? (currentKeyRef.current === cacheKey ? currentTermRef.current : null);
        if (termToSuspend) suspendWebglRenderer(termToSuspend);
      }
      detachAll();
      rebuildCallbacks.delete(cacheKey);
      wrapperRefs.delete(cacheKey);
      scrollDisposable?.dispose();
      currentTermRef.current = null;
    };
  }, [
    cacheKey,
    rebuildCount,
    taskRebuildKey,
    tabAgentId,
    taskCommand,
    taskConfigId,
    onSessionCreated,
    onSessionTitleChange,
    scheduleFit,
    // 字体属性：syncFont 在 effect 体内同步执行，须作为依赖（原本是独立 effect 的依赖）
    fontSize,
    fontFamilyProp,
    // Strategy values (via strategyRef to avoid unnecessary re-runs)
  ]);

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-text-secondary text-[var(--terminal-font-size)]">
          Connecting...
        </div>
      )}
      <div
        className="terminal-wrapper xterm-themed-scrollbar flex-1 p-0 pl-2 overflow-hidden min-w-0 min-h-0"
        style={{ backgroundColor: 'var(--terminal-bg)' }}
        ref={wrapperRef}
      />
      <button
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center w-8 h-8 rounded bg-bg-surface border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-opacity duration-150 cursor-pointer"
        style={{ opacity: isAtBottom ? 0 : 1, pointerEvents: isAtBottom ? 'none' : 'auto' }}
        onClick={handleScrollToBottom}
        title="Scroll to bottom"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 10L3 5H11L7 10Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
});
