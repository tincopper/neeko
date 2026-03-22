import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { Unicode11Addon } from "xterm-addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import "xterm/css/xterm.css";

interface Project {
  id: string;
  name: string;
  path: string;
  terminal: {
    id: string;
    pid: number | null;
    status: "Idle" | "Running" | "Failed";
    history: string[];
    agent: any;
  };
  selected_agent: string | null;
}

interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
}

interface TerminalViewProps {
  project: Project;
  fontSize?: number;
  shell?: string;
}

interface TerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlistenOutput: (() => void) | null;
}

// 全局缓存，切换项目时保留会话
const terminalCache = new Map<string, TerminalCache>();

// 存储每个 projectId 对应的"需要重建"回调，管道关闭时调用
const terminalRebuildCallbacks = new Map<string, () => void>();

function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [Terminal] ${msg}`);
}

function destroyTerminalCache(projectId: string) {
  const cache = terminalCache.get(projectId);
  if (!cache) return;
  cache.unlistenOutput?.();
  cache.term.dispose();
  terminalCache.delete(projectId);
  log(`Cache destroyed for ${projectId}`);
}

function sendToTerminal(projectId: string, text: string) {
  const cache = terminalCache.get(projectId);
  if (!cache?.sessionId) {
    log(`sendToTerminal: no session for ${projectId}`);
    return;
  }
  const bytes = Array.from(new TextEncoder().encode(text));
  emit(`terminal-input-${cache.sessionId}`, bytes).catch((err) => {
    log(`sendToTerminal error: ${err}`);
  });
}

// 导出给外部调用（App.tsx 的 AgentSelector 回调）
export function launchAgentInTerminal(projectId: string, command: string, args: string[]) {
  const cmdStr = [command, ...args].join(" ");
  sendToTerminal(projectId, "\x03");
  setTimeout(() => sendToTerminal(projectId, cmdStr + "\r"), 50);
}

async function createTerminalForProject(
  projectId: string,
  projectPath: string,
  projectName: string,
  selectedAgentId: string | null,
  fontSize: number,
  wrapper: HTMLElement,
  shell: string,
): Promise<TerminalCache> {
  log(`Creating new terminal for project ${projectName}`);

  const element = document.createElement("div");
  element.style.width = "100%";
  element.style.height = "100%";

  const term = new Terminal({
    cursorBlink: true,
    fontSize: fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    theme: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor:     "#528bff",
      selectionBackground: "#3e4451",
      black:   "#282c34",
      red:     "#e06c75",
      green:   "#98c379",
      yellow:  "#e5c07b",
      blue:    "#61afef",
      magenta: "#c678dd",
      cyan:    "#56b6c2",
      white:   "#abb2bf",
      brightBlack:   "#5c6370",
      brightRed:     "#e06c75",
      brightGreen:   "#98c379",
      brightYellow:  "#e5c07b",
      brightBlue:    "#61afef",
      brightMagenta: "#c678dd",
      brightCyan:    "#56b6c2",
      brightWhite:   "#ffffff",
    },
    scrollback: 10000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  // Unicode11：正确处理中文等宽字符的宽度计算
  const unicode11 = new Unicode11Addon();
  term.loadAddon(unicode11);
  term.unicode.activeVersion = "11";

  // 先挂载到 DOM，再 open，这样 fitAddon.fit() 能拿到真实容器尺寸
  wrapper.appendChild(element);
  term.open(element);
  fitAddon.fit();
  const initCols = term.cols;
  const initRows = term.rows;
  log(`Initial size: ${initCols}x${initRows}`);

  const cache: TerminalCache = {
    term,
    fitAddon,
    element,
    sessionId: null,
    unlistenOutput: null,
  };

  terminalCache.set(projectId, cache);
  term.write("\x1b[33m[Terminal] Connecting...\x1b[0m\r\n");

  try {
    const session = await invoke<{ id: string; pid: number | null }>(
      "create_terminal_session",
      { projectId, cols: initCols, rows: initRows, shell: shell || null }
    );
    const sid = session.id;
    cache.sessionId = sid;
    log(`Session created: ${sid}, PID: ${session.pid}`);
    term.write(`\x1b[32m[Terminal] Connected (PID: ${session.pid})\x1b[0m\r\n\r\n`);

    const unlistenOutput = await listen<number[]>(
      `terminal-output-${sid}`,
      (event) => {
        const bytes = new Uint8Array(event.payload);
        term.write(bytes);
      }
    );
    cache.unlistenOutput = unlistenOutput;

    // 监听管道关闭事件：显示提示后清理 cache 并触发重建
    const unlistenClosed = await listen<null>(
      `terminal-closed-${sid}`,
      async () => {
        log(`Session ${sid} closed by backend`);
        unlistenClosed();
        // 在终端上显示退出提示，3 秒后自动重建
        term.write("\r\n\x1b[33m[Terminal] Session ended. Restarting in 3 seconds...\x1b[0m\r\n");
        setTimeout(() => {
          destroyTerminalCache(projectId);
          terminalRebuildCallbacks.get(projectId)?.();
        }, 3000);
      }
    );

    // ── IME 输入处理 ──────────────────────────────────────────────────────
    // 问题：Linux 下 keydown(229) 先于 compositionstart 触发，xterm.js 的
    // onData 在 compositionstart 之前就会被调用，导致中间文本被发送到 PTY，
    // 同时 PTY 回显与前端显示叠加，产生「我是我」式重复输入。
    //
    // 解决方案（Unix）：
    //   1. Rust 端已禁用 PTY 回显（ECHO），由前端负责显示用户输入
    //   2. keydown(229) 时立即设 isComposing=true，阻断 onData 提前发送
    //   3. compositionend 时手动发送最终字符到 PTY，并在前端显示
    //   4. onData 用 compositionPendingText 过滤 compositionend 后的重复触发
    //
    // Windows：PTY 回显由系统负责，onData 正常发送即可（IME 行为不同）
    const isUnix = !navigator.platform.toLowerCase().includes("win");
    let isComposing = false;
    let compositionPendingText = "";

    const sendInput = (text: string) => {
      if (isUnix) {
        // Unix：PTY 已禁用回显，前端手动显示
        term.write(text);
      }
      const bytes = Array.from(new TextEncoder().encode(text));
      emit(`terminal-input-${sid}`, bytes).catch((err) => {
        log(`Input emit error: ${err}`);
      });
    };

    const textarea = term.textarea;
    if (textarea) {
      // keyCode 229：IME 组合开始的信号，在 compositionstart 之前触发
      // Linux 下必须在此处提前设置 isComposing，否则 onData 会先一步发出
      textarea.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.keyCode === 229 && !isComposing) {
          isComposing = true;
          compositionPendingText = "";
        }
      });
      textarea.addEventListener("compositionstart", () => {
        isComposing = true;
        compositionPendingText = "";
      });
      textarea.addEventListener("compositionend", (e: CompositionEvent) => {
        const committed = e.data || "";
        if (committed) {
          compositionPendingText = committed;
          sendInput(committed);
          // 延迟重置，防止 compositionend 后 onData 立即触发时误发
          setTimeout(() => {
            isComposing = false;
            compositionPendingText = "";
          }, 50);
        } else {
          isComposing = false;
          compositionPendingText = "";
        }
      });
    }

    term.onData((data) => {
      // composing 期间阻断
      if (isComposing) return;
      // compositionend 后 onData 可能携带相同文本，跳过避免重复发送
      if (compositionPendingText && data === compositionPendingText) {
        compositionPendingText = "";
        return;
      }
      sendInput(data);
    });
    // 如果项目有预设 agent，连接成功后自动启动
    if (selectedAgentId) {
      try {
        const agent = await invoke<AgentConfig>("get_agent", { agentId: selectedAgentId });
        const cmdStr = agent.command + (agent.args.length ? " " + agent.args.join(" ") : "") + "\r";
        sendToTerminal(projectId, cmdStr);
        log(`Auto-launched agent: ${agent.command}`);
      } catch (err) {
        log(`Auto-launch agent failed: ${err}`);
      }
    }

  } catch (err) {
    log(`ERROR: ${err}`);
    term.write(`\x1b[31m[Terminal] Connection failed: ${err}\x1b[0m\r\n`);
  }

  return cache;
}

export default function TerminalView({ project, fontSize = 14, shell = "" }: TerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentProjectIdRef = useRef<string | null>(null);
  // 管道关闭时递增，触发 useEffect 重建终端
  const [rebuildCount, setRebuildCount] = useState(0);

  // fontSize 变化时更新已有终端实例
  useEffect(() => {
    const cache = terminalCache.get(project.id);
    if (cache) {
      cache.term.options.fontSize = fontSize;
      cache.fitAddon.fit();
    }
  }, [fontSize, project.id]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const projectId = project.id;
    currentProjectIdRef.current = projectId;

    // 注册重建回调：管道关闭时，backend 会清理 session 并发 terminal-closed 事件，
    // createTerminalForProject 监听到后调用此 callback 触发 rebuildCount 递增，
    // 进而使当前 useEffect 重新运行，此时 cache 已被清除，会创建新终端
    terminalRebuildCallbacks.set(projectId, () => {
      if (currentProjectIdRef.current === projectId) {
        log(`Rebuild triggered for ${projectId}`);
        setRebuildCount((c) => c + 1);
      }
    });

    const attach = (cache: TerminalCache) => {
      if (!wrapper.contains(cache.element)) {
        wrapper.appendChild(cache.element);
      }
      requestAnimationFrame(() => {
        if (currentProjectIdRef.current !== projectId) return;
        cache.fitAddon.fit();
        if (cache.sessionId) {
          invoke("resize_terminal", {
            sessionId: cache.sessionId,
            cols: cache.term.cols,
            rows: cache.term.rows,
          }).catch(() => {});
        }
        cache.term.focus();
      });
    };

    const detachAll = () => {
      while (wrapper.firstChild) {
        wrapper.removeChild(wrapper.firstChild);
      }
    };

    detachAll();

    if (terminalCache.has(projectId)) {
      log(`Reattaching existing terminal for ${project.name}`);
      attach(terminalCache.get(projectId)!);
    } else {
      // 传入 wrapper，让函数内先挂载 element 再 fit，确保初始尺寸正确
      createTerminalForProject(projectId, project.path, project.name, project.selected_agent, fontSize, wrapper, shell).then((cache) => {
        if (currentProjectIdRef.current !== projectId) return;
        // element 已在函数内挂载，只需 focus 并同步后端尺寸
        requestAnimationFrame(() => {
          if (currentProjectIdRef.current !== projectId) return;
          cache.fitAddon.fit();
          if (cache.sessionId) {
            invoke("resize_terminal", {
              sessionId: cache.sessionId,
              cols: cache.term.cols,
              rows: cache.term.rows,
            }).catch(() => {});
          }
          cache.term.focus();
        });
      });
    }

    const handleResize = () => {
      const cache = terminalCache.get(projectId);
      if (!cache) return;
      cache.fitAddon.fit();
      if (cache.sessionId) {
        invoke("resize_terminal", {
          sessionId: cache.sessionId,
          cols: cache.term.cols,
          rows: cache.term.rows,
        }).catch(() => {});
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      detachAll();
      terminalRebuildCallbacks.delete(projectId);
    };
  }, [project.id, rebuildCount]);

  return (
    <div className="terminal-container">
      <div className="terminal-wrapper" ref={wrapperRef} />
    </div>
  );
}
