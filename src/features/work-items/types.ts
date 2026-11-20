/**
 * Local 工作项（Tasks 面板的本地 provider）的领域类型。
 *
 * 与 Rust 侧 `src-tauri/src/work_items/types.rs` **一一对应**（serde camelCase），
 * 改名/加字段必须两侧同一 diff 改完 —— 这条链没有代码生成，靠约定。
 *
 * 命名裁决（design §2.1）：中文「工作项」= WorkItem；「任务」单独出现只指
 * `TeamTask`（团队任务）。所以这里不出现 `Task` 这个词。
 */

/** stage 是数据（后端下发阶段集），不是联合类型 —— 自定义阶段不应引发前端改动。 */
export type WorkItemStage = string;

export interface StageTransition {
  from: WorkItemStage;
  to: WorkItemStage;
}

/** 阶段轨：顺序 + 允许的直接流转（相邻两两，见 design §11.5）。 */
export interface StagePlan {
  stages: WorkItemStage[];
  transitions: StageTransition[];
}

export type WorkItemPriority = 'p0' | 'p1' | 'p2' | 'p3';

export interface WorkItem {
  /** `wi_<uuid>` */
  id: string;
  projectId: string;
  title: string;
  body: string;
  stage: WorkItemStage;
  priority: WorkItemPriority | null;
  labels: string[];
  assignee: string | null;
  /** epoch 毫秒（与后端一致，不转 Date —— 时区是渲染层的事） */
  createdAt: number;
  updatedAt: number;
}

/** 执行方式三档（design §3.4）。本期只产出 `single`。 */
export type RunMode = 'single' | 'team' | 'flow';

/** 快照状态。`unknown` 是合法值：执行域里已经查不到了，不能伪装成 `failed`。 */
export type RunState = 'queued' | 'running' | 'awaiting' | 'done' | 'failed' | 'unknown';

export type RunRefKind = 'session' | 'team' | 'flow';

/** 指针：真相源在执行域，这里只够跳转与反查。 */
export interface RunRef {
  kind: RunRefKind;
  id: string;
  /** team 的 taskId 等次级定位；其余为 null。 */
  sub: string | null;
}

export interface WorkItemRunSnapshot {
  state: RunState;
  /** 原域文案（如「空闲 ⚠ 未声明」），≤ 120 字符。 */
  label: string;
  capturedAt: number;
}

/** 一次执行记录。**快照只是缓存**：任何「做完了没有」的判定回执行域查。 */
export interface WorkItemRun {
  /** `run_<uuid>` */
  id: string;
  workItemId: string;
  mode: RunMode;
  ref: RunRef;
  snapshot: WorkItemRunSnapshot;
  createdAt: number;
}

/**
 * `recordWorkItemRun` 的入参（`work_item_run_record`）。
 *
 * # 为什么 `refId` 在 `single` 档是**终端 tab id**
 *
 * PTY session id 在 tab 挂载时才生成，应用重启 / 终端重建后就不复存在了 —— 拿它当定位点，
 * 执行记录会指向一个不存在的会话。而 tab id 是我们自己 mint 的（`generateTerminalTabId()`），
 * 用户可见、`activateTab` 能定位、与 tab 同生共死（关掉就失效，UI 会如实置灰），适合做
 * 「跳回去」的锚点。`ref` 的字段形状不变，语义在这里收窄。
 *
 * # 本期只有 `mode = 'single'`
 *
 * 后端拒绝 `team` / `flow`（两档还没有写入方）。类型里保留三档，是因为读侧（详情面板的
 * mode 徽标）要能渲染历史记录；**写入面**只有 single。
 */
export interface RecordWorkItemRunParams {
  workItemId: string;
  mode: RunMode;
  refKind: RunRefKind;
  /** `single` 档 = 终端 tab id（见上方说明）。 */
  refId: string;
  /** 域内二级定位（团队的 `taskId` 等）；空 = 没有。 */
  refSub?: string | null;
  /** 抓取到的状态 —— 快照，不是判定。 */
  runState: RunState;
  /** 原域文案（如 agent 名），后端截到 120 字符。 */
  label: string;
}

export interface CreateWorkItemParams {
  projectId: string;
  title: string;
  body?: string;
  stage?: WorkItemStage;
  priority?: WorkItemPriority;
  labels?: string[];
  assignee?: string;
}

/**
 * 注意**没有** `stage`：改阶段只能走 `transitionWorkItem`，
 * 否则「不可跨阶段流转」这条规则可以被一次改名请求绕过。
 *
 * # 清空语义（跨端契约，后端 `UpdateWorkItem` 的文档同口径）
 *
 * Tauri 扁平解码区分不了「没传」与「传了 null」（两者都落 `Option::None`），
 * 所以清空用**空值**表达：
 *
 * | 字段 | `undefined` | 空值 |
 * | --- | --- | --- |
 * | `priority` | 不改 | `''` = 清空 |
 * | `assignee` | 不改 | `''` = 清空 |
 * | `labels` | 不改 | `[]` = 清空 |
 * | `title` | 不改 | `''` = **拒绝**（必填） |
 * | `body` | 不改 | `''` = 清空正文 |
 *
 * `priority` 的联合类型因此必须包含 `''` —— 把它写成封闭的 `'p0'…'p3'` 会让
 * 「清空优先级」在类型层就发不出去，编辑对话框只能默默不生效。
 */
export interface UpdateWorkItemParams {
  id: string;
  title?: string;
  body?: string;
  /** `''` = 清空。 */
  priority?: WorkItemPriority | '';
  /** `[]` = 清空。 */
  labels?: string[];
  /** `''` = 清空。 */
  assignee?: string;
}
