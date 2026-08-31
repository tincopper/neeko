import { emit, listen } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { createPollingDrainScheduler } from '@/shared/utils/drainLoop';
import { applyRenderer, buildTerminalTheme, TERMINAL_SCROLLBACK } from '@/shared/utils/terminal';
import { terminalClosedEvent, terminalInputEvent } from '@/shared/utils/terminalEvents';
import { setupTerminalInput } from '@/shared/utils/terminalInput';
import { buildMonoStack, MONO_LINE_HEIGHT } from '@/shared/utils/typography';

// eslint-disable-next-line import/no-restricted-paths -- terminal view needs agent API for agent config lookup
import { getAgent } from '../../agent/api/agentApi';
import { drainTerminal } from '../api/terminalApi';
import type { TerminalStrategy, CacheEntry } from '../strategies/types';

import { refreshTerminal, refreshRemoteTerminal, refreshWslTerminal } from './terminalCache';

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
  agentCommandOverride?: string;
  onStatusChange?: (status: 'Idle' | 'Running' | 'Failed') => void;
}

export default React.memo(function TerminalViewBase({
  strategy,
  tabAgentId,
  taskCommand,
  taskConfigId,
  taskRebuildKey = 0,
  agentCommandOverride,
  onStatusChange,
}: TerminalViewBaseProps) {
  const { cacheKey, cache, fontSize, fontFamily: fontFamilyProp } = strategy;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const currentTermRef = useRef<Terminal | null>(null);
  const strategyRef = useRef(strategy);
  strategyRef.current = strategy;
  const [rebuildCount, setRebuildCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const fitRafRef = useRef<number | null>(null);
  const fitTrailingRef = useRef<number | undefined>(undefined);
  const lastFitColsRef = useRef<number>(-1);
  const lastFitRowsRef = useRef<number>(-1);
  const pendingFitColsRef = useRef<number | null>(null);
  const pendingFitRowsRef = useRef<number | null>(null);
  // 哨兵定时器句柄：提升到组件作用域，effect cleanup 必须清除 —— 否则卸载/
  // 重建后僵尸定时器仍会在废弃闭包上触发 rebuildTerminal（重建风暴源头之一）。
  const stallTimerRef = useRef<number | undefined>(undefined);
  // 哨兵重建冷却时间戳：跨 effect 重跑存活（rebuild 会触发 effect 重入，
  // 局部变量冷却会被重置导致风暴）。
  const lastRebuildAtRef = useRef(0);

  const doFit = useCallback(() => {
    const key = currentKeyRef.current;
    if (!key) return;
    const c = strategyRef.current.cache.get(key);
    if (!c) return;
    const colsBefore = c.term.cols;
    const rowsBefore = c.term.rows;
    try {
      c.fitAddon.fit();
    } catch {
      return;
    }
    const colsAfter = c.term.cols;
    const rowsAfter = c.term.rows;
    const converged = colsAfter === colsBefore && rowsAfter === rowsBefore;
    // 收敛且无待重试 → 无需 resize
    if (converged && pendingFitColsRef.current === null) return;
    // 去重：与上次成功 resize 相同且无待重试 → 跳过
    if (
      colsAfter === lastFitColsRef.current &&
      rowsAfter === lastFitRowsRef.current &&
      pendingFitColsRef.current === null
    )
      return;
    if (!c.sessionId) {
      pendingFitColsRef.current = colsAfter;
      pendingFitRowsRef.current = rowsAfter;
      return;
    }
    const targetCols = colsAfter;
    const targetRows = rowsAfter;
    strategyRef.current.resize(c.sessionId, targetCols, targetRows).then(
      () => {
        lastFitColsRef.current = targetCols;
        lastFitRowsRef.current = targetRows;
        pendingFitColsRef.current = null;
        pendingFitRowsRef.current = null;
      },
      () => {
        pendingFitColsRef.current = targetCols;
        pendingFitRowsRef.current = targetRows;
      },
    );
  }, []);

  const scheduleFit = useCallback(() => {
    if (fitTrailingRef.current !== undefined) window.clearTimeout(fitTrailingRef.current);
    fitTrailingRef.current = window.setTimeout(() => {
      fitTrailingRef.current = undefined;
      doFit();
    }, 120);
    if (fitRafRef.current !== null) return;
    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = null;
      doFit();
    });
  }, [doFit]);

  const handleScrollToBottom = useCallback(() => {
    const term = currentTermRef.current;
    if (!term) return;
    term.scrollToBottom();
    term.focus();
  }, []);

  // Sync font changes to existing instance — unified via scheduleFit (trigger source 1)
  useEffect(() => {
    const c = strategyRef.current.cache.get(cacheKey);
    if (!c) return;
    c.term.options.fontSize = strategyRef.current.fontSize;
    c.term.options.fontFamily = buildMonoStack(strategyRef.current.fontFamily);
    c.term.options.lineHeight = MONO_LINE_HEIGHT;
    scheduleFit();
  }, [fontSize, fontFamilyProp, cacheKey, cache, scheduleFit]);
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
      connectingMessage: connectingMessageVal,
      createSession: createSessionVal,
      agentDelayMs: agentDelayMsVal,
      onSessionReady: onSessionReadyVal,
      outputFilter: outputFilterVal,
    } = strategyRef.current;

    currentKeyRef.current = cacheKey;
    setReady(false);

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

    const existingCache = cache.get(cacheKey);
    if (existingCache) {
      setReady(!!existingCache.sessionId);
      attach(existingCache);
      currentTermRef.current = existingCache.term;
      scrollDisposable = existingCache.term.onScroll(() => {
        setIsAtBottom(
          existingCache.term.buffer.active.viewportY >= existingCache.term.buffer.active.baseY,
        );
      });
    } else {
      const element = document.createElement('div');
      element.style.width = '100%';
      element.style.height = '100%';

      const term = new Terminal({
        cursorBlink: true,
        fontSize: fontSizeVal,
        fontFamily: buildMonoStack(fontFamilyVal),
        lineHeight: MONO_LINE_HEIGHT,
        theme: buildTerminalTheme(),
        scrollback: TERMINAL_SCROLLBACK,
        overviewRuler: { width: 0 },
        allowProposedApi: true,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      const unicode11 = new Unicode11Addon();
      term.loadAddon(unicode11);
      term.unicode.activeVersion = '11';

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

      term.write(connectingMessageVal);

      (async () => {
        try {
          const sessionId = await createSessionVal(term.cols, term.rows, {
            command: taskCommand ?? undefined,
            configId: taskConfigId ?? undefined,
          });

          if (currentKeyRef.current !== cacheKey) return;
          entry.sessionId = sessionId;
          setReady(true);
          onSessionReadyVal?.();

          // 当 taskCommand 已设置时（如 resume），跳过 auto-launch
          if (tabAgentId && !taskCommand) {
            const cmdOverride = agentCommandOverride;
            setTimeout(async () => {
              if (!entry.sessionId) return;
              try {
                const agent = await getAgent(tabAgentId);
                const cmd = cmdOverride ?? agent.command;
                const cmdStr = [cmd, ...agent.args].join(' ') + '\r';
                const bytes = Array.from(new TextEncoder().encode(cmdStr));
                // 静默豁免：终端输入，尽力而为，失败无需上报
                emit(terminalInputEvent(entry.sessionId), bytes).catch(() => {});
                onStatusChange?.('Running');
              } catch (err) {
                console.error('[Terminal] Auto-launch agent failed:', err);
              }
            }, agentDelayMsVal);
          }

          // credit-pull 输出协议（内存治理）：后端把 PTY 输出汇入有界
          // SessionDrain；前端经调度器拉取：draining 期间的新数据记
          // pendingWake 闩锁、门闸早退置 maybePending 残留证据、parse 回调经
          // onWriteDigested 续拉 —— 闭合全部丢失路径（冻结故障回炉，
          // 见任务 design.md §8）。事件队列不再无界积压。
          // 方案 B（去 eval 化）：触发源由 terminal-drain-{id} 事件改为全局
          // 共享轮询器（createPollingDrainScheduler）——macOS 上事件送达 =
          // 每次 evaluateJavaScript，WebKit 无条件克隆+stringify 完成值导致
          // WebContent RSS 只增不减；invoke 走 custom protocol fetch，零 eval。
          const pendingWrites = { current: 0 };

          const rebuildTerminal = (key: string): void => {
            // 冷却闸：风暴防护。冷却期内放弃本次自愈（下个哨兵周期再试）。
            const now = Date.now();
            if (now - lastRebuildAtRef.current < TERMINAL_REBUILD_COOLDOWN_MS) {
              console.warn('[Terminal] rebuild skipped (cooldown)', key);
              return;
            }
            lastRebuildAtRef.current = now;
            if (key.startsWith('wsl:')) refreshWslTerminal(key);
            else if (key.startsWith('remote:')) refreshRemoteTerminal(key);
            else refreshTerminal(key);
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

          const scheduler = createPollingDrainScheduler({
            sessionId,
            drain: drainTerminal,
            write: writeChunk,
            pendingWrites: () => pendingWrites.current,
          });

          // 会话自然退出（shell exit）后后端已移除 drain 条目并 close：
          // 若轮询器不注销，死会话每 100ms 一次 NotFound 错误 invoke 空转
          // （方案 B 引入的行为退化，neeko-check 审查项）。closed 后无数据
          // 可拉，注销绝对安全。
          const unlistenClosed = await listen(terminalClosedEvent(sessionId), () => {
            scheduler.dispose();
          });

          // 轮询注销挂到 entry.unlisten 槽位：terminalCache 销毁/重建统一经
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
          if (currentKeyRef.current !== cacheKey) return;
          setReady(true);
          term.write(`\x1b[31mFailed to connect: ${err}\x1b[0m\r\n`);
        }
      })();
    }

    // ── ResizeObserver 断自激改造 ─────────────────────────────────────
    // 原实现：RO 回调无条件 fit()。wrapper 的子元素（xterm canvas）尺寸
    // 变化同样会触发 RO，而 fit() 又改写 canvas 尺寸 → 尺寸反馈环 →
    // WebKit 每帧 full layout/paint 风暴（Jetsam 实锤：WebContent 超
    // 2GB soft limit 被处决导致白屏）。统一入口 scheduleFit：
    //   - contentRect 守卫：wrapper 自身尺寸未变（子元素噪声）→ 不调度
    //   - scheduleFit 内：RAF 合帧 + 120ms trailing 兜底 + 收敛去重 + 失败 pending 重试
    // 四触发源（RO/attach/字体/session-ready）均经此入口。
    let lastContentW = -1;
    let lastContentH = -1;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      // wrapper 自身尺寸变化不足 1px（多为子元素噪声）→ 直接忽略，断反馈环
      if (Math.abs(width - lastContentW) < 1 && Math.abs(height - lastContentH) < 1) return;
      lastContentW = width;
      lastContentH = height;
      // RO 触发源（4）：统一经 scheduleFit
      scheduleFit();
    });
    ro.observe(wrapper);

    return () => {
      if (fitRafRef.current !== null) cancelAnimationFrame(fitRafRef.current);
      if (fitTrailingRef.current !== undefined) window.clearTimeout(fitTrailingRef.current);
      fitRafRef.current = null;
      fitTrailingRef.current = undefined;
      // 哨兵卫生：清除未决的 stall 定时器，防止僵尸定时器在废弃闭包上触发
      // rebuildTerminal（重建风暴源头之一，任务 design.md §8.1 放大器 B）。
      if (stallTimerRef.current !== undefined) {
        window.clearTimeout(stallTimerRef.current);
        stallTimerRef.current = undefined;
      }
      ro.disconnect();
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
    agentCommandOverride,
    onStatusChange,
    scheduleFit,
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
        className="terminal-wrapper flex-1 p-0 pl-2 overflow-hidden min-w-0 min-h-0"
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
