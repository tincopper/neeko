/**
 * live-sessions 注册表快照的前端镜像（与 Rust `live_sessions::view` 逐字对应）。
 *
 * **这是视图层唯一的状态 / 标题来源**：tab 标题、侧栏单元角标、侧栏会话子列表都是
 * 同一份快照的纯投影 —— 视图不持有状态副本、不推断状态、不写标题。
 *
 * 字段形状由 Rust 侧的 `view_serializes_with_camel_case_fields_and_enum_values`
 * 用例钉住（camelCase 键 + 枚举小驼峰值）。
 */

/** 会话种类（Rust `SessionKind`）。 */
export type SessionKind = 'chat' | 'terminal';

/**
 * 运行时状态（Rust `SessionState`）。视图**只渲染**它，不得推断。
 *
 * 注意它**不是**持久化词表 `SessionStatus`：后者只有 `Closed`，没有被 Failed / Stopped
 * 区分的必要（见 design §6「不复用 SessionStatus」）。
 */
export type SessionState = 'ready' | 'running' | 'awaitingApproval' | 'failed' | 'stopped';

/**
 * 标题来源（Rust `TitleSource`），质量顺序 `placeholder < prompt < native < user`。
 *
 * **不进 UI**：它只决定「谁能覆盖谁」，界面只表达结果（有真标题 / 占位斜体）。
 */
export type TitleSource = 'placeholder' | 'prompt' | 'native' | 'user';

/** 一条 live session 的前端形态（Rust `SessionView`）。 */
export interface SessionView {
  /** 会话 id：chat 用 `tab.data.sessionId`，terminal 用 `tab.data.ptySessionId`。 */
  sessionId: string;
  kind: SessionKind;
  /** 该会话的 agent（纯 shell terminal 为 `null` ⇒ 图标回落 `cli.svg`）。 */
  agentId: string | null;
  /**
   * 执行地址 key（`WorkspaceSession.key()`）—— **后端铸造的唯一 key**。
   *
   * 单元分组只允许用它做相等比较：禁止在 selector 里拼分隔符或比路径前缀（红线 12）。
   */
  workspaceKey: string;
  title: string;
  titleSource: TitleSource;
  state: SessionState;
  /** ISO8601 */
  startedAt: string;
  /** ISO8601 —— UI 的相对时间用它（不伪造 Idle）。 */
  updatedAt: string;
  turnCount: number;
}

/** `list_live_sessions` 回包（Rust `LiveSessionsSnapshot`）。 */
export interface LiveSessionsSnapshot {
  version: number;
  sessions: SessionView[];
}

/** `wait_live_sessions` 回包（Rust `LiveSessionsWait`）。 */
export interface LiveSessionsWait {
  version: number;
  /** `false` = 超时（这段时间没有任何变更），此时 `version === since`。 */
  changed: boolean;
}
