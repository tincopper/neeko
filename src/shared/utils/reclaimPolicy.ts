/**
 * 闲置 webview 回收策略(纯函数,无 I/O)。
 *
 * 每项目一个 webview 且无上限会导致内存随项目数线性增长。
 * 决策规则:
 * - 活跃项目(当前项目)的 webview 永不回收。
 * - 未创建(无 webview)的项目跳过。
 * - 闲置超过 `maxIdleMs` 的 webview 回收(即使总数未超上限)。
 * - 总数超过 `maxWebviews` 时,从剩余未超闲置的 webview 中回收最久未用的。
 */

export interface WebviewReclaimPolicy {
  /** 非活跃 webview 闲置超过该时长(ms)即回收。 */
  maxIdleMs: number;
  /** 常驻 webview 总数上限(含活跃),超限回收最久未用。 */
  maxWebviews: number;
}

export interface WebviewUsage {
  /** webview 的唯一标识（如 `panel:{projectId}` / `tab:{tabId}`）。 */
  key: string;
  /** 最后活跃时间(epoch ms),切换到该 webview 时更新。 */
  lastActiveAt: number;
  /** webview 是否已创建(存在渲染资源)。 */
  isCreated: boolean;
  /** 是否为当前活跃 webview。 */
  isActive: boolean;
}

/** 默认策略:闲置 30 分钟回收,常驻上限 8 个。 */
export const DEFAULT_RECLAIM_POLICY: WebviewReclaimPolicy = {
  maxIdleMs: 30 * 60 * 1000,
  maxWebviews: 8,
};

/**
 * 决策哪些 webview 应被回收,返回 key 列表。
 *
 * @param usages 所有浏览器 webview 的使用快照
 * @param policy 回收策略
 * @param now 当前时间(epoch ms),便于测试注入
 */
export function decideReclaims(
  usages: WebviewUsage[],
  policy: WebviewReclaimPolicy,
  now: number,
): string[] {
  // 活跃 webview 永不回收;未创建的跳过
  const reclaimable = usages.filter((u) => u.isCreated && !u.isActive);

  // 1) 闲置超时回收
  const idleReclaims = reclaimable
    .filter((u) => now - u.lastActiveAt >= policy.maxIdleMs)
    .map((u) => u.key);

  // 2) 总数超限:从剩余(未超闲置)中回收最久未用,直到不超过上限
  const remaining = reclaimable.filter((u) => now - u.lastActiveAt < policy.maxIdleMs);
  const activeCount = usages.filter((u) => u.isCreated && u.isActive).length;
  const overage = activeCount + remaining.length - policy.maxWebviews;

  let extraReclaims: string[] = [];
  if (overage > 0) {
    extraReclaims = [...remaining]
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
      .slice(0, overage)
      .map((u) => u.key);
  }

  return [...idleReclaims, ...extraReclaims];
}
