/**
 * Output view for one TaskRun.
 *
 * Renders the run's accumulated `output` buffer into xterm. Live task runs also
 * forward keyboard input to the backend PTY so command prompts (for example
 * y/n confirmation) can be answered. LSP log tabs stay read-only.
 */
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import React, { useEffect, useRef } from 'react';

import { useAppContext } from '@/shared/contexts/AppContext';
import { useBrowserStore } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import {
  applyRenderer,
  buildTerminalTheme,
  safeDisposeTerminal,
  TERMINAL_SCROLLBACK,
} from '@/shared/utils/terminal';
import { setupTerminalInput, type TerminalInputController } from '@/shared/utils/terminalInput';
import { buildMonoStack, resolveTerminalLineHeight } from '@/shared/utils/typography';

import { writeTaskInput } from '../taskRunner';
import type { TaskRun } from '../types';
import { setupConsoleLinks } from '../utils/consoleLinks';

import '@xterm/xterm/css/xterm.css';

interface Props {
  run: TaskRun;
  active: boolean;
}

function TaskConsoleOutput({ run, active }: Props) {
  const { config } = useAppContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const inputControllerRef = useRef<TerminalInputController | null>(null);
  /** How much of `run.output` has already been written to the terminal. */
  const writtenLenRef = useRef(0);

  const readOnly = run.source === 'lsp' || run.status !== 'running';

  // Create / dispose terminal once per run id
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      convertEol: true,
      disableStdin: readOnly,
      cursorBlink: false,
      cursorStyle: 'underline',
      fontSize: config.terminalFontSize ?? 14,
      // 行高随字号缩放（与 TerminalViewBase/terminalFactory 一致）
      lineHeight: resolveTerminalLineHeight(config.terminalFontSize ?? 14),
      fontFamily: buildMonoStack(config.monoFontFamily ?? config.fontFamily ?? ''),
      theme: buildTerminalTheme(),
      scrollback: TERMINAL_SCROLLBACK,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    term.open(el);
    fit.fit();

    // 渲染器：确定性 RendererPlan 选型（启动期探测 + 预热，见 shared/utils/terminal）。
    // Task Console 保持固定 Canvas（不走 GPU 开关，与历史行为一致；
    // xterm 6 默认 DOM renderer 在高频输出下内存爆炸）。
    void applyRenderer(term, false);

    // Enable URL detection and file path links (must be after term.open)
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      useDockStore.getState().activatePanel('right', 'browser');
      useBrowserStore.getState().navigateTo(uri);
    });
    term.loadAddon(webLinksAddon);
    setupConsoleLinks(term, { projectPath: run.projectPath, projectId: run.projectId });

    termRef.current = term;
    fitRef.current = fit;
    writtenLenRef.current = 0;

    // Initial buffer (may already have content if panel reopened mid-run)
    if (run.output) {
      term.write(run.output);
      writtenLenRef.current = run.output.length;
      term.scrollToBottom();
    }

    // RO 断自激（对齐 TerminalViewBase 守卫模式）：xterm fit 会调整 canvas/
    // 容器尺寸 → 若内容尺寸随之变化会再次触发 RO → 无条件 fit 形成反馈循环
    // （WebKit 报 "ResizeObserver loop completed with undelivered notifications"
    // + 布局风暴 + 内存上升，窗口 resize 时尤其明显）。contentRect 守卫
    // （<1px 忽略）+ rAF 合帧，尺寸稳定后循环自然终止。
    let lastW = -1;
    let lastH = -1;
    let rafId: number | null = null;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (Math.abs(width - lastW) < 1 && Math.abs(height - lastH) < 1) return;
      lastW = width;
      lastH = height;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
      });
    });
    ro.observe(el);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      inputControllerRef.current?.dispose();
      inputControllerRef.current = null;
      ro.disconnect();
      safeDisposeTerminal(term);
      termRef.current = null;
      fitRef.current = null;
      writtenLenRef.current = 0;
    };
    // Only recreate when run identity / read-only mode changes — not when output grows
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: buffer streamed via second effect
  }, [run.id, readOnly, config.terminalFontSize, config.monoFontFamily, config.fontFamily]);

  // Attach input only while the backend session id exists and the run is live.
  // Font config changes recreate xterm above, so input must be reattached afterward.
  useEffect(() => {
    const term = termRef.current;
    const processId = run.processId;
    inputControllerRef.current?.dispose();
    inputControllerRef.current = null;

    if (!term || run.source === 'lsp' || run.status !== 'running' || !processId) {
      return;
    }

    inputControllerRef.current = setupTerminalInput({
      term,
      sendInput: (text) => writeTaskInput(processId, text),
    });

    return () => {
      inputControllerRef.current?.dispose();
      inputControllerRef.current = null;
    };
  }, [
    run.source,
    run.status,
    run.processId,
    config.terminalFontSize,
    config.monoFontFamily,
    config.fontFamily,
  ]);

  // Stream new output chunks without rewriting the whole buffer
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const full = run.output;
    const prev = writtenLenRef.current;
    if (full.length < prev) {
      // Buffer was reset (re-run) — clear and rewrite
      term.reset();
      term.write(full);
      writtenLenRef.current = full.length;
      term.scrollToBottom();
      return;
    }
    if (full.length > prev) {
      term.write(full.slice(prev));
      writtenLenRef.current = full.length;
      term.scrollToBottom();
    }
  }, [run.output]);

  // Fit + show when becoming active
  useEffect(() => {
    if (!active) return;
    const fit = fitRef.current;
    requestAnimationFrame(() => {
      try {
        fit?.fit();
      } catch {
        /* ignore */
      }
      termRef.current?.scrollToBottom();
      termRef.current?.focus();
    });
  }, [active, run.id]);

  return (
    <div
      className="absolute inset-0 flex flex-col min-h-0 min-w-0"
      style={{ display: active ? 'flex' : 'none' }}
      data-testid={`task-console-output-${run.id}`}
      data-run-status={run.status}
    >
      <div
        ref={containerRef}
        className="xterm-themed-scrollbar flex-1 min-h-0 min-w-0 overflow-hidden pl-2"
        style={{ backgroundColor: 'var(--terminal-bg, var(--bg-secondary))' }}
      />
    </div>
  );
}

export default React.memo(TaskConsoleOutput);
