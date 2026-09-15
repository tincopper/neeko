/**
 * codelldb / libtest 调试台输出噪音过滤（纯函数，供 debugStore 输出处理使用）。
 *
 * codelldb 启动时会在 DEBUG CONSOLE 打 VSCode 通用 banner（`Console is in
 * 'commands' mode`、`Loading Rust formatters from …`、`For more information
 * visit …`）——对普通用户无信息量，与真实程序输出一并渲染只会刷屏。
 * `Starting:` / `Launched process` 等真实输出不在此列，保留。
 */

/** codelldb 启动 banner 噪音前缀（VSCode DEBUG CONSOLE 三连）。 */
const CODELLDB_NOISE_PREFIXES = [
  "Console is in 'commands' mode",
  'Loading Rust formatters from',
  'For more information visit',
] as const;

/** 该行是否为 codelldb 启动 banner 噪音（命中任一前缀）；空串 / 换行非噪音。 */
export function isCodelldbNoise(text: string): boolean {
  return CODELLDB_NOISE_PREFIXES.some((prefix) => text.startsWith(prefix));
}
