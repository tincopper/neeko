/**
 * 文件/目录拖拽投递：dragStart 时把路径记到模块级变量，dragEnd 时按**插入端口身份**仲裁。
 *
 * - 用 `dragend`（保证触发、无需 `preventDefault`、不吞掉浏览器默认拖放）。
 * - **不自动提交**（不加 `\r`）—— 路径只是被插入，用户可以继续编辑。
 *
 * # 本文件的两次形态修正（读之前先看这两条）
 *
 * **一、不再有「焦点在文本元素」这条启发式**（原 `isTextInputElement`）：xterm 的输入载体
 * 本身就是 `<textarea class="xterm-helper-textarea">`，终端聚焦时该判据恒为 true，于是文本被
 * 投给一个零监听者的 DOM 事件后丢弃 —— 拖文件到终端与拖到 agent 输入**两端都是静默 no-op**。
 * 焦点现在只允许作为「命中**已注册端口**的键」（`resolvePortAtFocus`）。
 *
 * **二、不再有「agent 输入优先、终端兜底」这条两段链**：终端那段按 `paneId = 'p1'` 解析 PTY，
 * 终端只要不在第一个 pane（右侧 dock / 分屏）就必然 miss，而且 `{ ok: false }` 无任何提示 ——
 * 用户看到的就是「拖了，什么都没发生，Console 干净」。现在投递目标由 `shared/inputs` 的端口
 * 注册表回答：**谁能接文本，谁自己带着身份来登记**（PTY sessionId / paneId / 激活态 / DOM 根
 * 只有渲染方同时持有，「猜 paneId」这一步在结构上不存在）。
 *
 * 仲裁顺序见 `arbitrate()`：① 指针落点 ② 焦点所在端口 ③ 聚焦的普通文本控件
 * ④ composer ⑤ 代码编辑器 ⑥ 终端 ⑦ `onUnhandled`（可见失败，**禁止静默 return**）。
 *
 * 域边界（R5）：本模块属 `file` 域，**不得** import UI（toast / store 组件）。
 * 可见性由调用方注入 `options.onUnhandled`（`ProjectView` 传 `showToast`）。
 */

import { useEffect, useRef } from 'react';

import {
  portsOf,
  resolvePortAtFocus,
  resolvePortAtPoint,
  type InsertPort,
} from '@/shared/inputs/insertPorts';
import { focusedTextControl } from '@/shared/inputs/textControlPort';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

interface DragPayload {
  path: string;
  projectId: ProjectId;
}

let pendingDrag: DragPayload | null = null;

/**
 * 拖拽期间最后一次指针坐标（`dragover` 只记坐标，**不** `preventDefault`：
 * 本仓刻意走 `dragend` 而不是 `drop`，坐标是唯一低耦合的落点信号）。
 */
let lastPointer: { x: number; y: number } | null = null;

export function setDragFile(path: string, projectId: ProjectId): void {
  pendingDrag = { path, projectId };
  lastPointer = null;
}

// ---------------------------------------------------------------------------
// 仲裁（本文件是唯一实现处）
// ---------------------------------------------------------------------------

/** ④⑤⑥ 的三级降级：各页的取舍不同，写在一处，不要合并成一个循环。 */
function tryPorts(ports: readonly InsertPort[], text: string, tried: string[]): InsertPort | null {
  for (const port of ports) {
    if (tryPort(port, text, tried)) return port;
  }
  return null;
}

/** 激活者优先，其余保持登记顺序（`filter` 保序）。 */
function activeFirst(ports: readonly InsertPort[]): InsertPort[] {
  return [...ports.filter((p) => p.isActive()), ...ports.filter((p) => !p.isActive())];
}

interface ArbitrateResult {
  /** 落地的端口 id；null = 一个都没接住。 */
  landed: string | null;
  /** 依次试过的端口 id（未命中时交给 `console.debug`）。 */
  tried: string[];
}

function tryPort(port: InsertPort | null, text: string, tried: string[]): boolean {
  if (!port) return false;
  tried.push(port.id);
  return port.insert(text);
}

/**
 * 按身份仲裁「这段文本该进哪个面」，第一个真的落地的端口胜出。
 *
 * 每一级都真的调 `insert()`：**能不能落地由端口回答，调用方不猜**（端口的返回值
 * 就是「有没有落地」的唯一答案，`false` 继续下一个候选）。
 */
export function arbitrate(sessionKey: string, text: string): ArbitrateResult {
  const tried: string[] = [];

  // ① 用户明确把文件丢在这个端口上
  const atPoint = lastPointer ? resolvePortAtPoint(sessionKey, lastPointer.x, lastPointer.y) : null;
  if (tryPort(atPoint, text, tried)) return { landed: atPoint?.id ?? null, tried };

  // ② 焦点在该端口内（如正在编辑器里打字）—— 焦点是**端口的键**，不是「这是什么输入」
  const atFocus = resolvePortAtFocus(sessionKey);
  if (atFocus !== atPoint && tryPort(atFocus, text, tried)) {
    return { landed: atFocus?.id ?? null, tried };
  }

  // ③ 聚焦的普通文本控件：合成端口，失败（值/选区没变）继续降级
  const control = focusedTextControl();
  if (control) {
    tried.push('text-control');
    if (control.insert(text)) return { landed: 'text-control', tried };
  }

  // ④ composer：挂在且沿序试（未挂载的不在注册表里，旧行为一致）
  const composer = tryPorts(activeFirst(portsOf(sessionKey, 'agent-composer')), text, tried);
  if (composer) return { landed: composer.id, tried };

  // ⑤ 代码编辑器：**仅前台 tab** —— 光标在后台 tab 的文档里，插进去用户是看不见的。
  const editor = tryPorts(
    portsOf(sessionKey, 'code-editor').filter((p) => p.isActive()),
    text,
    tried,
  );
  if (editor) return { landed: editor.id, tried };

  // ⑥ 终端：**前台 pane 优先，其余兜底** —— 右侧 dock / 分屏里的终端也必须能落地
  // （旧实现按 `paneId='p1'` 解析，非首 pane 必然静默 miss，这就是本次事故）。
  const terminal = tryPorts(activeFirst(portsOf(sessionKey, 'terminal')), text, tried);
  if (terminal) return { landed: terminal.id, tried };

  return { landed: null, tried };
}

// ---------------------------------------------------------------------------
// Hook — mount once at the top of the component tree (ProjectView)
// ---------------------------------------------------------------------------

export interface FileDropOptions {
  /**
   * 全部端口都拒绝（或根本没有端口）时的唯一可见出口。
   * 由调用方注入（`file` 域不 import UI，R5）；不注入时只留 `console.debug`。
   */
  onUnhandled?: (text: string) => void;
}

export function useFileDrop(options: FileDropOptions = {}): void {
  // 回调走 ref：监听器只装一次，不因每次渲染的新闭包反复摘装。
  const onUnhandledRef = useRef(options.onUnhandled);
  useEffect(() => {
    onUnhandledRef.current = options.onUnhandled;
  }, [options.onUnhandled]);

  useEffect(() => {
    const handleDragOver = (event: DragEvent) => {
      lastPointer = { x: event.clientX, y: event.clientY };
    };

    const handleDragEnd = () => {
      const pending = pendingDrag;
      pendingDrag = null;
      if (!pending) return;

      const text = `${pending.path} `;
      const session = activeWorkspaceSession(pending.projectId);
      const { landed, tried } = arbitrate(session.key, text);
      if (landed) return;

      // ⑦ 静默失败是本次事故的主因（「拖了，什么都没发生，Console 干净」）——
      // 这里必须留下可诊断的痕迹，并把可见性交给注入的回调。
      console.debug('[file-drop] no port accepted', { text, session: session.key, tried });
      onUnhandledRef.current?.(text);
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragend', handleDragEnd);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragend', handleDragEnd);
    };
  }, []);
}
