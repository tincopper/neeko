/**
 * 卡片的**相对时间**文案（"3 天前" / "5 分钟前"）。
 *
 * # 为什么是纯函数且 `now` 可注入
 *
 * 卡片每次渲染都会调用它。如果函数内部读 `Date.now()`：
 *
 * 1. 同一份数据两次渲染结果不同 ⇒ `React.memo` 全灭（卡片在每次父级渲染时重算）；
 * 2. 测试只能靠「等」或 mock 全局时钟，后者会污染同文件其它用例；
 * 3. 「刷新」看起来像「数据变了」—— 用户会以为列表被重新拉过一次。
 *
 * 所以 `now` 是**必传参数**（不给默认值）：调用方（`WorkItemCard`）在渲染期取一次，
 * 同一帧内所有卡片用同一个基准。判据由此变成「纯函数 + 可断言」。
 *
 * # 为什么不用现成的 `formatRelativeTime`
 *
 * 仓里已有两份（`features/git/components/gitlog/commitListUtils.ts`、
 * `features/notification/components/NotificationList.tsx`），但它们是**英文**（"3d ago"）
 * 且各自绑着那个域的语义（commit 时间 / 通知时间）。工作项卡片要中文短文案
 * （参考图是"3 天前"），且这里的分档与它们不同（卡片只关心「多久没动过」）。
 * 三份各自内联才是真重复 —— 抽出来放 `utils/`，将来工作项详情要复用时只 import。
 *
 * # 分档
 *
 * 卡片是窄列里的扫视信息，**只保留能改变判断的档位**：
 *
 * | 差值 | 文案 | 为什么这样切 |
 * | --- | --- | --- |
 * | < 1 分钟 | 刚刚 | 「0 分钟前」读起来像坏了 |
 * | < 1 小时 | N 分钟前 | 分钟级是「正在发生」 |
 * | < 24 小时 | N 小时前 | 小时级是「今天」 |
 * | < 7 天 | N 天前 | 参考图的主档位 |
 * | < 30 天 | N 周前 | 天 → 周是扫视粒度的自然切换 |
 * | < 365 天 | N 个月前 | — |
 * | 更久 / 非法输入 | 空串 | **不猜**：未来时间戳（时钟漂移）与 NaN 一律不画 |
 */
import type { TaskItem } from '../viewModel';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * `updatedAt`（epoch 毫秒）→ 相对时间文案。
 *
 * 返回**空串**表示「不显示」：调用方据此不渲染时间元素，而不是渲染一个空的占位。
 * 空串的三种来源都是「说出来就是错的」：非法输入、未来时间戳（`now` 早于 `updatedAt`）。
 */
export function relativeUpdatedAt(updatedAt: number, now: number): string {
  if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) return '';

  const diff = now - updatedAt;
  // 未来时间戳：`Date.now()` 与后端写入时钟可能不同源（跨机 / 时区 / 手动改系统时间）。
  // 显示「-2 分钟前」比不显示更糟，所以一律不画。
  if (diff < 0) return '';

  if (diff < MINUTE_MS) return 'just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;

  const days = Math.floor(diff / DAY_MS);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * 卡片上的时间取哪个字段。
 *
 * **用 `updatedAt` 而不是 `createdAt`**：看板列是「它现在处于哪个阶段」，用户扫视时问的
 * 是「这条多久没动过了」—— 那正是 `updatedAt`。`createdAt` 对一条 3 个月前建、昨天刚流转
 * 的卡片会显示"3 个月前"，读起来像「这件事烂了三个月」，与实际相反。
 *
 * PR 的 `updatedAt` 等于 `createdAt`（`prToTask` 的注释说明了原因：列表里没有 updatedAt，
 * 不拿 `Date.now()` 充数），所以 PR 卡片显示的是「PR 创建多久了」——语义可接受。
 */
export function cardTimeOf(item: Pick<TaskItem, 'updatedAt'>, now: number): string {
  return relativeUpdatedAt(item.updatedAt, now);
}
