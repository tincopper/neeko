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

interface TerminalViewProps {
  project: Project;
}

function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [Terminal] ${msg}`);
}

export default function TerminalView({ project }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    log(`=== Component Mount ===`);
    log(`Project: ${project.name} (${project.id})`);
    log(`Path: ${project.path}`);

    if (!containerRef.current) {
      log("ERROR: No container ref!");
      return;
    }

    // 创建 xterm 实例
    log("Creating xterm instance...");
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        cursor: "#c0caf5",
        selectionBackground: "#33467c",
      },
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;
    log("xterm instance created and opened");

    // 显示初始消息
    term.write("\x1b[33m[Terminal] Initializing...\x1b[0m\r\n");

    // 监听 PTY 输出事件: Rust -> Frontend
    const initSession = async () => {
      try {
        log("Calling create_terminal_session...");
        term.write("\x1b[33m[Terminal] Creating PTY session...\x1b[0m\r\n");

        const session = await invoke<{ id: string; pid: number | null }>(
          "create_terminal_session",
          { projectId: project.id }
        );

        const sid = session.id;
        sessionIdRef.current = sid;
        log(`Session created! ID: ${sid}, PID: ${session.pid}`);
        term.write(`\x1b[32m[Terminal] Session created (PID: ${session.pid})\x1b[0m\r\n`);
        term.write(`\x1b[90m[Terminal] Listening on: terminal-output-${sid}\x1b[0m\r\n`);
        term.write(`\x1b[90m[Terminal] Emitting to: terminal-input-${sid}\x1b[0m\r\n\r\n`);

        // 监听终端输出
        log(`Registering output listener: terminal-output-${sid}`);
        const unlisten = await listen<number[]>(
          `terminal-output-${sid}`,
          (event) => {
            const bytes = new Uint8Array(event.payload);
            const text = new TextDecoder().decode(bytes);
            log(`Received ${event.payload.length} bytes from PTY`);
            term.write(bytes);
          }
        );
        unlistenRef.current = unlisten;
        log("Output listener registered successfully");

        term.write(`\x1b[32m[Terminal] ✓ Ready! Type a command...\x1b[0m\r\n\r\n`);
        
      } catch (err) {
        log(`ERROR creating session: ${err}`);
        term.write(`\x1b[31m[Terminal] ✗ Connection failed: ${err}\x1b[0m\r\n`);
      }
    };

    initSession();

    // 监听用户输入: Frontend -> Rust
    log("Setting up input handler...");
    term.onData((data) => {
      const sid = sessionIdRef.current;
      if (!sid) {
        log("Input ignored - no session ID");
        return;
      }

      // 将字符串编码为字节数组发送给后端
      const bytes = Array.from(new TextEncoder().encode(data));
      log(`Sending ${bytes.length} bytes to PTY: ${JSON.stringify(data)}`);
      emit(`terminal-input-${sid}`, bytes).catch((err) => {
        log(`ERROR emitting input: ${err}`);
      });
    });

    // 窗口大小变化
    const handleResize = () => {
      log("Window resized, fitting terminal...");
      fitAddon.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      log("=== Component Unmount ===");
      window.removeEventListener("resize", handleResize);
      unlistenRef.current?.();
      term.dispose();
    };
  }, [project.id]);

  return (
    <div className="terminal-container">
      <div className="terminal-toolbar">
        <div className="terminal-tabs">
          <div className="terminal-tab active">
            <span className="tab-icon">💻</span>
            <span className="tab-title">{project.name}</span>
          </div>
        </div>
      </div>
      <div className="terminal-wrapper" ref={containerRef} />
      <div className="terminal-status-bar">
        <span>Session: {sessionIdRef.current?.slice(0, 8) || "..."}</span>
        {project.terminal.pid && <span>PID: {project.terminal.pid}</span>}
      </div>
    </div>
  );
}
