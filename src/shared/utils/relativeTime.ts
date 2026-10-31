/**
 * 相对时间标签（侧栏会话行的「最近活动」）。
 *
 * 口径与设计原型一致：`刚刚` / `30s` / `2m` / `3h` / `2d`。
 * **不引依赖**：日期库只为一个标签进产物不值得，且它们的本地化输出会随环境漂移，
 * 测试无法钉住。
 */

/** 5 秒内算「刚刚」：再小的秒数在侧栏里只是噪声，且会让高频刷新看起来像在跳字。 */
const JUST_NOW_SECONDS = 5;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/**
 * 把 ISO8601 时间转成相对标签。
 *
 * @param iso 后端回传的 `updatedAt` / `startedAt`。
 * @param now 当前时刻（毫秒，测试注入用）。
 * @returns 标签；`iso` 无法解析时返回空串 —— 调用方据此不渲染（伪造 `0s` 比空白更误导）。
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';

  // 时钟回拨 / 未来时间一律当「刚刚」：显示负秒数只会让用户以为数据坏了。
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (seconds <= JUST_NOW_SECONDS) return '刚刚';
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s`;
  if (seconds < SECONDS_PER_HOUR) return `${Math.round(seconds / SECONDS_PER_MINUTE)}m`;
  if (seconds < SECONDS_PER_DAY) return `${Math.round(seconds / SECONDS_PER_HOUR)}h`;
  return `${Math.round(seconds / SECONDS_PER_DAY)}d`;
}
