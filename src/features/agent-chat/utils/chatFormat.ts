/**
 * chatFormat.ts — 对话时间/时长格式化纯函数。
 *
 * 与 `agent-chat-v2.html` 原型的 `.msg-timestamp`（24H 制，如 "14:32"）与
 * `worked-card` 的 "Worked for 12s" 对齐。无 React / store 依赖。
 */

/** 短时钟标签：如 "14:32"（小时+分钟，无秒）。固定 en-GB + hour12:false 保证 24 小时制。 */
export function formatChatTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * 话轮耗时标签：如 `12s` / `1m` / `1m 05s`。
 * 对齐原型 "Worked for 12s"；整秒向下取整，整分钟省略秒位。
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  const sec = seconds < 10 ? `0${seconds}` : String(seconds);
  return `${minutes}m ${sec}s`;
}
