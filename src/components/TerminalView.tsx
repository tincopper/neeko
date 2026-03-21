import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
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

function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [Terminal] ${msg}`);
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
  term.open(element);

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
      { projectId }
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

    term.onData((data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      emit(`terminal-input-${sid}`, bytes).catch((err) => {
        log(`Input emit error: ${err}`);
      });
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

export default function TerminalView({ project, fontSize = 14 }: TerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentProjectIdRef = useRef<string | null>(null);

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
      createTerminalForProject(projectId, project.path, project.name, project.selected_agent, fontSize).then((cache) => {
        if (currentProjectIdRef.current !== projectId) return;
        detachAll();
        attach(cache);
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
    };
  }, [project.id]);

  return (
    <div className="terminal-container">
      <div className="terminal-wrapper" ref={wrapperRef} />
    </div>
  );
}
