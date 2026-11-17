import type { TeamState } from '@/shared/types/team';

/**
 * 团队列表（`team_list`）的**纯派生**函数：状态徽标 / 项目根末段 / 创建时间。
 *
 * # 为什么徽标是纯函数而不是组件里的三元
 *
 * `TeamState` 是**三态**，且 `closing` 不是 `open` 的修辞变体：「关到一半」是一个
 * 可查询、可重试的真实状态（有成员关不掉时整次 `team_close` 以 `Err` 结束，团队停在这里）。
 * 把它并进 `open` 会让用户看到一个「运行中」的队，而它的成员进程关不掉 —— 那正是
 * 面板最该说清楚的一件事。文案 / 语义色 / 可访问文本三处因此必须**同源**且互不相同，
 * 由本文件一处产出（同 `memberBadge` 的纪律）。
 *
 * 面板头部与列表行都从这里取，不各写一份映射：两份映射的漂移是静默的（都自洽，只是
 * 同一个队在两处叫两个名字）。
 */

/** 徽标的语义色（组件映射到 token class，颜色不在这里拼）。 */
export type TeamStateTone = 'open' | 'closing' | 'sealed';

export interface TeamStateBadge {
  /** 视觉文案（人读的短标签）。 */
  text: string;
  /** 语义色。 */
  tone: TeamStateTone;
  /**
   * 可访问文本：视觉文案太短，读屏 / 悬停要拿到「这意味着什么」。
   *
   * `ariaLabel` 与 `text` **都**逐态不同 —— 只改颜色的「可区分」在灰度与色觉障碍下等于
   * 不存在（同 AC2 的判据口径）。
   */
  ariaLabel: string;
}

const BADGE: Record<TeamState, TeamStateBadge> = {
  open: {
    text: 'Running',
    // 与 `sealed` 的差别是**能不能恢复**，不只是颜色：`open` 的队重启后可以整体拉起来。
    tone: 'open',
    ariaLabel:
      'Running: tasks can be dispatched and the team can be fully restored after a restart',
  },
  closing: {
    text: 'Closing',
    tone: 'closing',
    ariaLabel: 'Closing: some members did not shut down; you can retry closing',
  },
  sealed: {
    text: 'Sealed',
    tone: 'sealed',
    ariaLabel: 'Sealed: read-only snapshot, not restored after a restart',
  },
};

/** 团队状态 → 徽标（唯一映射点）。 */
export function teamStateBadge(state: TeamState): TeamStateBadge {
  return BADGE[state];
}

/**
 * 项目根的**末段**（窄面板里塞不下绝对路径）。
 *
 * 只是展示派生（不参与任何「这是不是同一个目录」的判定 —— 那件事的唯一判据是
 * `FileRef` 系列）。完整路径仍然进 `title`，所以信息没有丢，只是默认不摆出来。
 *
 * 末尾分隔符 / 混合分隔符都要能吃：后端的 `project_path` 是规范化过的，但用户看到的值
 * 与夹具里的值未必同一个来源，露出一个「末段为空」的行比多两行切分代码更糟。
 */
export function projectRootTail(path: string): string {
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== '');
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

/**
 * 建队时间（epoch 毫秒 → `YYYY-MM-DD HH:mm`）。
 *
 * 用本地时区（用户要的是「我什么时候开的这个队」）。不引第三方相对时间库：列表里
 * 「3 天前」经过一次渲染就不再更新，而它在 dock 里可能挂着几小时。
 */
export function formatCreatedAt(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
