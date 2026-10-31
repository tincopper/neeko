/**
 * Agent Chat 统一事件协议（前端镜像）。
 *
 * 与 `src-tauri/src/agent_chat/events.rs` 的 `StreamEvent` / `SessionRequest`
 * 保持同步（serde tag="type" + rename_all="snake_case"）。禁止两端各自漂移。
 */

/** 配置项的**写入机制**（与后端 `ConfigCapability` 同源，`snake_case`）。 */
export type ConfigCapability = 'session_config' | 'per_turn' | 'none';

/** agent 的一条 slash 命令（`list_agent_commands` 返回；镜像后端 `AgentCommand`）。 */
export interface AgentCommandEntry {
  /** 命令名（插入文本是 `/name`，不含斜杠 —— agent 自己会展开）。 */
  name: string;
  /** 展示用说明；agent 不给时为 null。 */
  description?: string | null;
  /** 来源标记（pi：`prompt` / `skill` / `extension`），仅用于展示。 */
  source?: string | null;
}

/** 会话能力声明（session_start 携带）。
 *
 * 镜像 `src-tauri/src/agent/chat/events.rs::Capabilities`。两侧字段必须同步 ——
 * 这里缺字段不会编译报错，只会让消费方静默拿到 `undefined`。
 */
export interface Capabilities {
  /** 是否支持审批 Gate（A2）。 */
  approvals: boolean;
  /** 是否发出 CommandRun 事件（Dock 终端回显）。 */
  command_echo: boolean;
  /** 是否发出 FileDiff 事件。 */
  diff: boolean;
  /** 是否支持 resume_id 会话恢复。 */
  resume: boolean;
  /**
   * 是否能列出 slash 命令（`/` 补全入口的**唯一**判据，缺省视为 false ——
   * 旧后端不传该字段时不能凭空假定支持）。
   */
  commands?: boolean;
  /**
   * 会话配置项的读写机制。
   *
   * `session_config` = 可发 `set_config_option`；`per_turn` = 只能随每轮请求带
   * （如 serve 的 `Turn { model_id }`）；`none` = 不支持。
   *
   * 缺省视为 `none`（旧后端不传该字段时不能凭空假定支持）。
   */
  config?: ConfigCapability;
}

/**
 * 一个 ACP 会话配置项（`configOptions`）。
 *
 * 模型列表就藏在这里：`category === 'model'` 的项的 `options` 即可选模型。
 * 协议没有独立的「列模型」方法，`session/new` 响应是唯一来源。
 */
export interface SessionConfigOption {
  /** 选项标识（`session/set_config_option` 的 `configId`）。 */
  id: string;
  /** 展示名。 */
  name: string;
  /** 可选说明。 */
  description?: string | null;
  /** 语义分类：`model` / `model_config` / `thought_level` / `mode`。可缺失。 */
  category?: string | null;
  /** `"select"` | `"boolean"`；缺省视为 select（协议规定）。 */
  type?: string | null;
  /**
   * 当前值：select 为字符串，boolean 为布尔。
   *
   * 字段名是 **camelCase**（`currentValue`）—— 后端 `#[serde(rename)]` 同时作用于
   * 读和写，所以线上两个方向都是 camelCase。写成 `current_value` 不会编译报错
   * （两端独立声明），但运行时该字段恒为 `undefined`，于是「会话当前值优先」静默失效。
   */
  currentValue?: string | boolean | null;
  /** select 形态的可选值（分组形态已由后端展平）。 */
  options?:
    | {
        value: string;
        name: string;
        description?: string | null;
        /**
         * 可选分组标识 —— `value` 不唯一时与它一起构成主键。
         *
         * Pi 的模型里 `deepseek-v4-pro` 会出现在多个 provider 下（实测
         * 224 条 / 194 唯一）。丢掉它 → React key 重复 + 搜不到 provider。
         */
        group?: string;
      }[]
    | null;
}

/** 从 `configOptions` 里取模型条目的可选值（`category === 'model'` 那一项）。 */
export function modelsFromConfigOptions(options: SessionConfigOption[] | undefined) {
  if (!options) return [];
  // 与后端同为三级定位：category 优先，id 兜底。规范明说 category 只是 UX 提示、
  // 不能据以判正确性，所以两者都要认。
  const modelOption =
    options.find((o) => o.category === 'model') ?? options.find((o) => o.id === 'model');
  return (modelOption?.options ?? []).map((item) => ({
    id: item.value,
    name: item.name,
    description: item.description ?? undefined,
    // 与 `ModelInfo.group` 同为「缺省即无分组」：统一用 `undefined`，
    // 不用 `null` —— 后端 `Option<String>` 配 `skip_serializing_if` 时字段是
    // **缺失**（`undefined`），两种表示混用会让 `modelKeyOf` 的判据分叉。
    group: item.group ?? undefined,
  }));
}

/** 会话当前的模型 ID（`configOptions` 里模型项的 `current_value`）。 */
export function currentModelFromConfigOptions(
  options: SessionConfigOption[] | undefined,
): string | undefined {
  if (!options) return undefined;
  const modelOption =
    options.find((o) => o.category === 'model') ?? options.find((o) => o.id === 'model');
  const value = modelOption?.currentValue;
  return typeof value === 'string' ? value : undefined;
}

/**
 * 模型项的 `configId`（写 `set_config_option` 时要用的真实标识）。
 *
 * 与 `currentModelFromConfigOptions` 同源定位（category 优先、id 兜底）——
 * 读和写必须用同一套判据，否则会出现「列得出来但切不动」。
 */
export function modelConfigIdFrom(options: SessionConfigOption[] | undefined): string | undefined {
  if (!options) return undefined;
  const modelOption =
    options.find((o) => o.category === 'model') ?? options.find((o) => o.id === 'model');
  return modelOption?.id;
}

/** 上下文清单（context_init / context_set）。 */
export interface ContextManifest {
  /** **执行根**（agent 进程的 cwd）。不是项目 ID —— 它已由执行地址解析、并做过归属校验。 */
  cwd: string;
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
  /**
   * 本次会话的执行地址 key（`{projectId}\0{worktreePath}`，主 checkout 尾段为空）。
   *
   * 为什么是 key 而不是 `{projectId, worktreePath}` 两个字段：分量化的 wire 形态可独立
   * 缺失/错配，而仓内其余事件（`git.ts` / `file.ts`）一律只带 `workspace_key`。分量经
   * `WorkspaceSession.fromKeyOrId` 这一个 codec 取，双端只有一种表示。
   *
   * 恒存在：项目级调用（`agent_chat_context`）回显主 checkout 的 key。
   */
  workspace_key: string;
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
  /** 当前上下文占用（pi `contextUsage.tokens`；compaction 后暂缺）。 */
  context_tokens?: number;
  /** 模型上下文窗口上限（pi `contextUsage.contextWindow`）。 */
  context_limit?: number;
  /** 会话累计缓存读取 token（pi `tokens.cacheRead`）。 */
  cache_read_tokens?: number;
  /** 会话累计缓存写入 token（pi `tokens.cacheWrite`）。 */
  cache_write_tokens?: number;
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
      /** ACP 会话配置项；非 ACP 传输为空/缺失。 */
      config_options?: SessionConfigOption[];
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
  | {
      /** agent 主动推送的配置变更（全量替换）。 */
      type: 'config_option_update';
      session_id: string;
      config_options: SessionConfigOption[];
    }
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
