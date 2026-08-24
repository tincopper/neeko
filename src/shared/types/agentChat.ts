/**
 * Agent Chat 统一事件协议（前端镜像）。
 *
 * 与 `src-tauri/src/agent_chat/events.rs` 的 `StreamEvent` / `SessionRequest`
 * 保持同步（serde tag="type" + rename_all="snake_case"）。禁止两端各自漂移。
 */

/** 会话能力声明（session_start 携带）。 */
export interface Capabilities {
  /** 是否支持审批 Gate（A2）。 */
  approvals: boolean;
  /** 是否发出 CommandRun 事件（Dock 终端回显）。 */
  command_echo: boolean;
  /** 是否发出 FileDiff 事件。 */
  diff: boolean;
  /** 是否支持 resume_id 会话恢复。 */
  resume: boolean;
}

/** 上下文清单（context_init / context_set）。 */
export interface ContextManifest {
  /** 项目 ID。 */
  project_id: string;
  /** 项目显示名。 */
  project_name: string;
  /** 执行环境：`local` | `wsl` | `ssh`。 */
  env: string;
  /** 启用的 skill ID 列表。 */
  skills: string[];
  /** 附加的文件路径列表。 */
  files: string[];
  /** 审批模式：`auto` | `confirm`。 */
  mode: string;
}

/** 话轮结束原因。 */
export type TurnEndReason = 'completed' | 'stopped' | 'error';

/** 会话结束原因。 */
export type DoneReason = 'completed' | 'cancelled' | 'error';

/** 流错误种类。 */
export type ErrorKind = 'agent' | 'protocol' | 'transport';

/** Token 用量遥测。 */
export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
}

/** Agent 实时任务清单项（todo_updated 事件负载）。 */
export interface TodoItem {
  /** 任务描述。 */
  content: string;
  /** `pending` | `in_progress` | `completed` | `cancelled`。 */
  status: string;
  /** `high` | `medium` | `low`。 */
  priority: string;
}

/**
 * 统一事件协议（Contract C1）。所有 adapter 产出、前端消费。
 * `type` 字段为判别器（snake_case）。
 */
export type StreamEvent =
  | {
      type: 'session_start';
      session_id: string;
      agent: string;
      model?: string | null;
      capabilities: Capabilities;
    }
  | ({
      type: 'context_init';
      session_id: string;
    } & ContextManifest)
  | { type: 'turn_start'; session_id: string; turn_id: string }
  | { type: 'turn_end'; session_id: string; turn_id: string; reason: TurnEndReason }
  | { type: 'text_delta'; session_id: string; delta: string }
  | { type: 'reasoning_delta'; session_id: string; delta: string }
  | { type: 'tool_start'; session_id: string; call_id: string; name: string; title: string }
  | { type: 'tool_output'; session_id: string; call_id: string; output: string }
  | { type: 'tool_end'; session_id: string; call_id: string; status: string }
  | {
      type: 'request_approval';
      session_id: string;
      call_id: string;
      tool: string;
      title: string;
      prompt: string;
      diff?: string | null;
      cmd?: string | null;
    }
  | { type: 'user_input'; session_id: string; turn_id: string; prompt: string; options?: string[] }
  | { type: 'command_run'; session_id: string; call_id: string; cwd: string; cmd: string }
  | {
      type: 'todo_updated';
      session_id: string;
      todos: TodoItem[];
    }
  | { type: 'proposed_plan'; session_id: string; plan: string }
  | { type: 'file_diff'; session_id: string; call_id: string; path: string; diff: string }
  | { type: 'meta'; session_id: string; model?: string | null; usage?: Usage | null }
  | { type: 'session_done'; session_id: string; reason: DoneReason }
  | { type: 'error'; session_id: string; kind: ErrorKind; code: string; message: string };

/**
 * A [`StreamEvent`] wrapped with a monotonic sequence number (P3 — event reducer
 * idempotency). The frontend uses `seq` to deduplicate events during
 * resume/replay: if an event with the same `seq` has already been applied, it is
 * skipped. Mirrors `src-tauri/src/agent/chat/events.rs` `SequencedEvent`.
 *
 * Note: `event` is flattened into the JSON (serde flatten), so the actual JSON
 * shape is `{ seq, type, session_id, ... }` (no nested `event` object).
 */
// Rust 端使用 #[serde(flatten)]，输出 JSON 为 { seq, type, session_id, ... }
// （seq 与 event 字段同级，无嵌套）。TS 展开后与 flatten 语义一致。
export type SequencedEvent = {
  /** Monotonic sequence number (per-session, assigned by the bridge). */
  seq: number;
} & StreamEvent;
