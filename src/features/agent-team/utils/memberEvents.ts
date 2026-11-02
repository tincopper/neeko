import type { MemberEventView } from '@/shared/types/team';

/**
 * 成员事件流的三处展示映射：**类别文案 / 时间 / 摘要行**。
 *
 * # 为什么 `kind` 的映射是「开集 + 兜底」
 *
 * 后端 `kind` 是开集字符串（`store::TeamEventRecord` 的文档：新增事件类别不该要求一次迁移）。
 * 若这里写成封闭 `Record<Kind, string>` 并在查不到时返回空串，一次后端新增事件类型就会让
 * 抽屉里出现一行**空白**——看起来像一条损坏的数据，而不是「我们还没给它起中文名」。
 * 所以兜底是**原样显示 kind**：它至少仍能让用户与日志对上。
 *
 * 这条映射与后端常量（`manager::EVENT_*`）**故意不共享类型**：TS 侧不需要在编译期知道
 * 全部类别（它也不该成为第二份真相源），只在文案层面跟着走。
 */
const KIND_TEXT: Record<string, string> = {
  claim: '认领任务',
  update: '更新任务',
  force_done: '队长判定完成',
  reclaim: '租约回收',
  blocked: '任务冻结',
  signal: '状态信号',
  issue_token: '签发凭证',
  bind_terminal: '绑定终端',
  close_request: '关闭请求',
  close_begin: '开始解散',
  close_team: '团队已关闭',
  close_member: '归档成员',
};

/** 类别 → 人读文案（未知类别原样返回，见文件头）。 */
export function memberEventKindText(kind: string): string {
  return KIND_TEXT[kind] ?? kind;
}

/**
 * 事件时间：`HH:MM:SS`（本地时区）。
 *
 * 只到秒：审计表里同一毫秒可能有多条（一次动作写多条），毫秒反而制造噪声。
 * 日期不在这一行显示 —— 抽屉看的是「刚刚发生了什么」，跨天的老事件已经接近 50 条上限，
 * 完整时间戳（含日期）交给 `title`。
 */
export function memberEventTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 摘要行最多显示多少字符（超出加省略号；全文进 `title`）。 */
export const MEMBER_EVENT_DETAIL_MAX = 80;

/**
 * 事件流上界（**镜像** `src-tauri/src/agent/team/view.rs::MAX_MEMBER_EVENTS`）。
 *
 * 只用于文案（「只显示最近 N 条」）—— 真正的截断在后端，且是在 SQL 的 `LIMIT` 里。
 * 改后端常量必须同步这里，否则提示会说出一个后端并没用过的数字（同 `taskBoard` 的
 * `MAX_BOARD_TASKS`）。
 */
export const MAX_MEMBER_EVENTS = 50;

/**
 * 事件的 `detail` → 一行摘要。
 *
 * 后端写的是**短文本**（`"state=Done at=1700…"` 一类），但仍然可能带换行（多行上下文），
 * 所以先拍平成一行再截断；`title` 拿完整原文（截断后的视觉文案不该成为唯一可得的信息）。
 *
 * @returns `null` = 后端没写 detail（这一行就只显示「时间 + 类别」）。
 */
export function memberEventSummary(event: Pick<MemberEventView, 'detail'>): {
  /** 画在行上的短文本。 */
  line: string;
  /** 悬停 / 读屏拿到的完整原文（**只有一行时与 `line` 相同**）。 */
  full: string;
} | null {
  const raw = event.detail?.trim();
  if (!raw) return null;
  const flattened = raw.replace(/\s+/g, ' ');
  if (flattened.length <= MEMBER_EVENT_DETAIL_MAX) {
    return { line: flattened, full: flattened };
  }
  return { line: `${flattened.slice(0, MEMBER_EVENT_DETAIL_MAX)}…`, full: flattened };
}
