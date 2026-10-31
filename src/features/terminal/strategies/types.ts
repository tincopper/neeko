import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

import type { TerminalInputController } from '@/shared/utils/terminalInput';

export interface CacheEntry {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
  inputController: TerminalInputController | null;
  /**
   * 这个 entry **不拥有** 会话进程（接管了后端已建好的会话，如团队队长/成员 PTY）。
   *
   * 要区分所有权是因为「销毁缓存」与「杀掉进程」是两件事：关 tab / 自愈重建只该销毁缓存，
   * 而进程的生命周期归它的创建者（团队域 `TeamManager` 的关闭协议）。不区分的话，用户
   * 关掉队长终端 tab 就会 `kill` 掉整个团队的队长，而在界面上看不出是谁干的。
   */
  attached?: boolean;
}

export interface TerminalStrategy {
  kind: 'local' | 'wsl' | 'remote';
  cacheKey: string;
  cache: Map<string, CacheEntry>;
  rebuildCallbacks: Map<string, () => void>;
  wrapperRefs: Map<string, HTMLDivElement>;
  createSession: (
    cols: number,
    rows: number,
    payload?: { command?: string; configId?: string },
  ) => Promise<string>;
  resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  agentDelayMs: number;
  fontSize: number;
  fontFamily: string;
  gpuAccel: boolean;
  onSessionReady?: () => void;
  /**
   * 本策略要接管的后端会话 id（非 null ⇒ 会话已存在，`createSession` 直接返回它）。
   *
   * 与 [`CacheEntry::attached`] 同源：entry 据此记住「只借看、不拥有」，销毁/重建时不下发
   * `close_terminal_session`。来源是 tab data 的 `existingSessionId`（团队入口写入）。
   */
  attachedSession?: string | null;
  /** Optional output byte filter (Local removes 0x7f DEL) */
  outputFilter?: (bytes: Uint8Array) => Uint8Array | Uint8Array<ArrayBuffer>;
  /** Optional file links setup after terminal creation */
  setupFileLinks?: (term: Terminal) => void;
}
