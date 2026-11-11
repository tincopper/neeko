/**
 * 执行快照的陈旧度判据（design §4.6「`snapshot.capturedAt` 超阈显示 · 已过期」）。
 *
 * # 陈旧是**渲染提示**，不是数据有效性判据
 *
 * 快照（`WorkItemRun.snapshot`）是 hub 侧缓存：真相源在执行域（design §3.4）。
 * 「已过期」只说明**这枚徽标可能不准了**，不说明执行失败了、也不说明可以忽略它 ——
 * 任何「做完了没有」的判定都必须回执行域查（团队域的完成权威是任务板显式声明）。
 * 所以这里没有任何「过期 ⇒ 丢弃 / 重算 / 标红成 failed」的逻辑，只有一句「它可能旧了」。
 *
 * # 为什么阈值只有一处定义
 *
 * 两处阈值的症状是「同一个面板里两个徽标口径不同」。今天唯一的消费者是
 * [`WorkItemRunsSection`](../components/WorkItemRunsSection.tsx)。
 */

/**
 * 超过 60 秒就算旧：低于这个量级时「刚跑完」与「一分钟前跑完」对人没有区别，
 * 而更长的阈值会让一个真的停在那里的执行看起来仍然是活的。
 */
export const RUN_STALE_THRESHOLD_MS = 60_000;

/**
 * `capturedAt` 距今是否超阈。
 *
 * 严格大于（`>`）：正好 60 秒的那一帧还不算「超出」。`capturedAt` 落在未来
 * （时钟回拨 / 跨机快照）时差值为负 ⇒ 不算旧 —— 宁可少标一次，也不要把刚拿到的快照标成过期。
 */
export function isStale(
  capturedAt: number,
  now: number,
  thresholdMs: number = RUN_STALE_THRESHOLD_MS,
): boolean {
  return now - capturedAt > thresholdMs;
}

/**
 * 快照时间的**绝对**呈现（`toLocaleString`），不是「N 分钟前」。
 *
 * 相对时间需要一个「现在」，而渲染期读时钟是非纯渲染（同一份 props 两次渲染会得到两个字符串）；
 * 靠定时器刷新相对时间又正是 design §4.6 禁止的自动轮询。所以时间只呈现绝对值，
 * 悬停时由调用方补完整 ISO。
 */
export function formatCapturedAt(at: number): string {
  return new Date(at).toLocaleString();
}
