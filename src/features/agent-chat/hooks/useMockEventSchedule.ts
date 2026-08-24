import { useEffect, type MutableRefObject } from 'react';

import type { SequencedEvent } from '@/shared/types/agentChat';

export interface MockEventScheduleParams {
  mockMode: boolean;
  sessionId: string | undefined;
  projectId: string;
  applyEvent: (ev: SequencedEvent) => void;
  sessionIdRef: MutableRefObject<string | undefined>;
  turnStartRef: MutableRefObject<number | null>;
  turnCountsRef: MutableRefObject<{ ran: number; edited: number; searched: number }>;
  turnToolsRef: MutableRefObject<Array<{ callId: string }>>;
}

/**
 * 开发/演示用：调度 mock 事件序列，模拟 agent 流式输出。
 * 与真实事件流共用 applyEvent reducer，保证两条链路行为一致。
 */
export function useMockEventSchedule({
  mockMode,
  sessionId,
  projectId,
  applyEvent,
  sessionIdRef,
  turnStartRef,
  turnCountsRef,
  turnToolsRef,
}: MockEventScheduleParams): void {
  useEffect(() => {
    if (!mockMode) return;

    const sid = sessionId ?? `mock-${Date.now()}`;
    sessionIdRef.current = sid;
    turnStartRef.current = Date.now();
    turnCountsRef.current = { ran: 0, edited: 0, searched: 0 };
    turnToolsRef.current = [];

    const timers: ReturnType<typeof setTimeout>[] = [];
    let seq = 0;

    const schedule = (delay: number, ev: SequencedEvent) => {
      timers.push(setTimeout(() => applyEvent(ev), delay));
    };

    // 1. Session start
    schedule(0, {
      seq: seq++,
      type: 'session_start',
      session_id: sid,
      agent: 'mock-agent',
      model: 'mock-model-v1',
      capabilities: { approvals: true, command_echo: true, diff: true, resume: false },
    });

    // 2. Context init with skills
    schedule(100, {
      seq: seq++,
      type: 'context_init',
      session_id: sid,
      project_id: projectId,
      project_name: projectId,
      env: 'local',
      skills: ['codebase-design', 'rust-patterns'],
      files: ['src/main.rs', 'Cargo.toml'],
      mode: 'confirm',
    });

    // 3. Turn start
    schedule(250, {
      seq: seq++,
      type: 'turn_start',
      session_id: sid,
      turn_id: 'mock_turn_1',
    });

    // 4. Agent loop: 文本 → 工具 → 文本（先输出意图，再执行工具，保持流式顺序）
    schedule(300, {
      seq: seq++,
      type: 'reasoning_delta',
      session_id: sid,
      delta: '用户要求分析项目结构。我需要先读取关键文件，然后进行一些修改。',
    });
    schedule(500, {
      seq: seq++,
      type: 'text_delta',
      session_id: sid,
      delta:
        '你好，我是 mockAgent。我已收到你的消息，正在分析项目结构。让我先读取几个关键文件，然后进行一些修改。\n\n',
    });
    // 穿插1: 读取文件（先说要读取，再执行工具）
    schedule(800, {
      seq: seq++,
      type: 'reasoning_delta',
      session_id: sid,
      delta: '我需要先读取 adapter.rs 文件来了解当前的适配器接口定义。',
    });
    schedule(1000, {
      seq: seq++,
      type: 'text_delta',
      session_id: sid,
      delta: '让我先读取 adapter.rs 文件。\n\n',
    });
    schedule(1200, {
      seq: seq++,
      type: 'tool_start',
      session_id: sid,
      call_id: 'read_1',
      name: 'read_file',
      title: 'src-tauri/src/agent/chat/adapter.rs',
    });
    schedule(1400, {
      seq: seq++,
      type: 'tool_output',
      session_id: sid,
      call_id: 'read_1',
      output:
        'use crate::agent::chat::events::{SessionRequest, StreamEvent};\n\npub trait AgentAdapter: Send + Sync {\n    fn kind(&self) -> AgentKind;\n    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError>;\n}',
    });
    schedule(1600, {
      seq: seq++,
      type: 'tool_end',
      session_id: sid,
      call_id: 'read_1',
      status: 'done',
    });

    // 穿插2: 编辑文件
    schedule(1900, {
      seq: seq++,
      type: 'reasoning_delta',
      session_id: sid,
      delta: '已读取文件。现在我需要添加 capabilities 方法到 trait 中。',
    });
    schedule(2100, {
      seq: seq++,
      type: 'text_delta',
      session_id: sid,
      delta: '已读取 adapter.rs。现在准备修改它。\n\n',
    });
    schedule(2300, {
      seq: seq++,
      type: 'tool_start',
      session_id: sid,
      call_id: 'edit_1',
      name: 'edit_file',
      title: 'src-tauri/src/agent/chat/adapter.rs',
    });
    schedule(2500, {
      seq: seq++,
      type: 'tool_output',
      session_id: sid,
      call_id: 'edit_1',
      output:
        'Successfully applied edit to src-tauri/src/agent/chat/adapter.rs\n@@ -15,7 +15,9 @@\n pub trait AgentAdapter: Send + Sync {\n     fn kind(&self) -> AgentKind;\n-    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError>;\n+    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError>;\n+    fn capabilities(&self) -> Capabilities;\n }',
    });
    schedule(2700, {
      seq: seq++,
      type: 'tool_end',
      session_id: sid,
      call_id: 'edit_1',
      status: 'done',
    });

    // 穿插3: 执行命令
    schedule(3000, {
      seq: seq++,
      type: 'reasoning_delta',
      session_id: sid,
      delta: '修改完成。现在执行 cargo check 验证编译是否通过。',
    });
    schedule(3200, {
      seq: seq++,
      type: 'text_delta',
      session_id: sid,
      delta: '✅ 已允许。修改已应用到 adapter.rs。\n\n现在执行一条命令来验证修改。\n\n',
    });
    schedule(3400, {
      seq: seq++,
      type: 'command_run',
      session_id: sid,
      call_id: 'cmd_1',
      cwd: `/Users/user/${projectId}`,
      cmd: 'cargo check --message-format=json',
    });
    schedule(3700, {
      seq: seq++,
      type: 'tool_output',
      session_id: sid,
      call_id: 'cmd_1',
      output:
        'Compiling neeko v1.0.6 (debug)\n   Finished `dev` profile [optimized] target(s) in 8.99s',
    });
    schedule(3900, {
      seq: seq++,
      type: 'tool_end',
      session_id: sid,
      call_id: 'cmd_1',
      status: 'done',
    });

    // 穿插4: 最终文本总结
    schedule(4200, {
      seq: seq++,
      type: 'reasoning_delta',
      session_id: sid,
      delta: '编译通过。让我总结本次处理的结果。',
    });
    schedule(4400, {
      seq: seq++,
      type: 'text_delta',
      session_id: sid,
      delta:
        '✅ 编译通过。\n\n本轮处理完成！以上就是 mockAgent 的完整模拟流程，包括：\n\n• 文件读取（tool_start → tool_output → tool_end）\n• 文件编辑（带 diff 预览）\n• 命令执行\n\n你可以继续发送消息进行多轮对话。',
    });

    // Token 用量遥测
    schedule(4700, {
      seq: seq++,
      type: 'meta',
      session_id: sid,
      model: 'mock-model-v1',
      usage: { input_tokens: 1234, output_tokens: 567 },
    });

    // Turn end
    schedule(5000, {
      seq: seq++,
      type: 'turn_end',
      session_id: sid,
      turn_id: 'mock_turn_1',
      reason: 'completed',
    });

    // Session done
    schedule(5200, {
      seq: seq++,
      type: 'session_done',
      session_id: sid,
      reason: 'completed',
    });

    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockMode, projectId]);
}
