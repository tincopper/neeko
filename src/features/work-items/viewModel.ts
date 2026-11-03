/**
 * Tasks 面板的**视图模型**：本地工作项与外部 provider（本期只有 GitHub PR）在看板上的统一形状。
 *
 * # 为什么它不在 `types.ts` 里
 *
 * `types.ts` 的 `WorkItem` 是 Rust `work_item` 表的镜像（serde camelCase），改它 = 改 IPC 契约。
 * `source` / `pr` 这两个字段**永远不来自 Rust**，也永远不该被写进那条链：一旦塞进 DTO，
 * 后端要么多两列空字段，要么前端每次发请求都得把它们剥掉。所以视图模型单独一层：
 * DTO 说什么就是什么，视图说什么由本文件决定。
 *
 * # 为什么 id 是 string 而不是继续用 `wi_` 前缀
 *
 * 两个 provider 的 id 空间不同：本地是 `wi_<uuid>`（后端铸造），GitHub 是 `github:pr:<number>`
 * （provider + 平台稳定编号）。**不换算、不改写** —— 反查时 `id` 必须能原样交回产出它的那一侧
 * （本地回 `workItemsStore`，GitHub 回 `gitApi`）。所以 `TaskItem.id` 是「provider 原始 id」，
 * 前缀就是它来自哪个 provider 的自证，而不是一个可以随便改的展示串。
 *
 * # 纯函数，不许读时钟 / 随机数
 *
 * `toLocalTask` / `prToTask` 必须是**同一输入两次调用结果相等**的纯映射：面板每次渲染都会
 * 重新映射一遍，任何时间/随机成分都会让 `React.memo` 全灭并让「刷新」看起来像「数据变了」。
 */

import type { PRListItem } from '@/shared/types/git';

import type { WorkItem } from './types';

/** 工作项的来源。**只增不改**：新增 provider 时旧值必须保持原样（它们可能已经在偏好/日志里）。 */
export type TaskSource = 'local' | 'github';

/** GitHub PR 的 id 前缀：`github:pr:<number>`。 */
export const GITHUB_PR_ID_PREFIX = 'github:pr:';

/**
 * PR 的展示侧摘要。
 *
 * 比 `PRListItem` 少（只留看板与详情真的会渲染的字段），比它多两样：
 * - `repo`：仓库标签。`PRListItem` 里只有 `headRepositoryOwner`（fork 时是别人的 owner），
 *   拿不到 `owner/name`；所以由调用方（宿主）注入，空串 = 不知道（详情里就只显示 `#128`）。
 * - `state`：provider 的**原始**状态。列位置是映射后的 `stage`，但「OPEN 被放进 Review 列」
 *   这件事必须让用户看得见原始值，否则详情会把映射结果冒充成 PR 的真实状态。
 */
export interface TaskPullRequest {
  number: number;
  headRefName: string;
  baseRefName: string;
  author: string;
  repo: string;
  state: string;
  /** PR 页面地址。**列表拿不到**（`PRListItem` 没有 url），详情按需经 `viewPr` 补。 */
  url?: string;
}

/**
 * 看板 / 列表 / 详情共用的一条工作项。
 *
 * 结构上是 `WorkItem` 的超集（所以 `TaskItem` 可以直接交给只认 DTO 的下游，如执行记录区），
 * 只把 `id` 放宽成「provider 原始 id」并加上来源字段。
 */
export interface TaskItem extends Omit<WorkItem, 'id'> {
  /** provider 原始 id（`wi_…` / `github:pr:128`），不换算。 */
  id: string;
  source: TaskSource;
  /** 仅 `source === 'github'` 时存在。 */
  pr?: TaskPullRequest;
}

/**
 * 本地工作项 → 视图模型。**只加来源，不改任何字段**：本地那套（stage / 流转 / 执行区 /
 * 撤销窗口）全部按原样工作，视图模型层不是改数据的地方。
 */
export function toLocalTask(item: WorkItem): TaskItem {
  return { ...item, source: 'local' };
}

/** ISO 时间 → epoch 毫秒；解析不出来就是 `0`（不抛、不读当前时间）。 */
function epochMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * PR 状态 → 看板列（stage）。
 *
 * # 为什么 `OPEN` 落在 `Review`，而不是 design §4.5 通用规则的 `In Progress`
 *
 * §4.5 那条是**通用**映射（`open/draft → Backlog/Ready`，面向 issue/ticket：开了 = 还没人干）。
 * PR 的语义不同：一个开着的 PR 意味着「代码已经写完，正在等 review」。把它放进 `Backlog`
 * 会让「我的活干完了没有」这个唯一有用的判断反着说 —— 用户会以为自己还有一堆没开始的 PR。
 * 落在 `Review` 正好是它此刻真正占用的那段流程。
 *
 * 未知状态落 `In Progress` 而不是被丢弃：provider 加一个新状态（比如 `DRAFT`）时，卡片必须
 * **仍然出现在某一列**。掉出看板的卡片在界面上与「不存在」无法区分 —— 那是最坏的一种谎报。
 */
export function prStage(state: string): string {
  const normalized = state.trim().toUpperCase();
  if (normalized === 'OPEN') return 'Review';
  if (normalized === 'MERGED' || normalized === 'CLOSED') return 'Done';
  return 'In Progress';
}

/**
 * `PRListItem` → 视图模型（纯映射）。
 *
 * # 有几个字段是「没有」而不是「空」
 *
 * | 字段 | 取值 | 为什么 |
 * | --- | --- | --- |
 * | `projectId` | `''` | 外部 provider 的工作项不属于任何本地项目的库；写路径永远拿不到它（只读），空串表示「不适用」而不是某个项目 |
 * | `body` | `''` | `PRListItem` 不带正文；正文属于详情，按需经 `viewPr` 拉 |
 * | `priority` | `null` | GitHub 没有优先级字段，不要从 labels 里猜 |
 * | `updatedAt` | `= createdAt` | 列表里没有 updatedAt。**不拿 `Date.now()` 充数** —— 那会让同一份数据每次映射都"刚更新" |
 *
 * `labels` 只取名字（颜色是渲染细节，GitHub 的色值是十六进制，不能进我们的 token 体系）；
 * `assignee` 取第一个（卡片只有一格 `@名字`，多人时详情再补）。
 */
export function prToTask(pr: PRListItem, repoLabel: string): TaskItem {
  return {
    id: `${GITHUB_PR_ID_PREFIX}${pr.number}`,
    projectId: '',
    title: pr.title,
    body: '',
    stage: prStage(pr.state),
    priority: null,
    labels: pr.labels.map((label) => label.name),
    assignee: pr.assignees[0]?.login ?? null,
    createdAt: epochMs(pr.createdAt),
    updatedAt: epochMs(pr.createdAt),
    source: 'github',
    pr: {
      number: pr.number,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      author: pr.author,
      repo: repoLabel,
      state: pr.state,
    },
  };
}
