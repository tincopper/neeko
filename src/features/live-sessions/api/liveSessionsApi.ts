import { invoke } from '@tauri-apps/api/core';

import type { LiveSessionsSnapshot, LiveSessionsWait } from '@/shared/types/liveSessions';
import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * live-sessions 快照的 IPC 端口（后端常量与命令见 `src-tauri/src/live_sessions/`）。
 *
 * 协议是 **credit-pull**：后端只在版本变化时 emit 一个版本号，快照靠这里显式拉。
 * 不推送全量 —— macOS WebKit 上每次事件送达 = 一次 `evaluateJavaScript` + 完成值克隆，
 * 推送快照会让 RSS 只增不减（同终端 drain 的结论）。
 */

/**
 * 拉一次快照。
 *
 * @param workspace 传地址 ⇒ 只返回该单元；缺省 ⇒ 全部（侧栏要跨单元，故 bridge 不传）。
 */
export function listLiveSessions(
  workspace?: WorkspaceSession | null,
): Promise<LiveSessionsSnapshot> {
  return invoke<LiveSessionsSnapshot>('list_live_sessions', { workspace: workspace ?? null });
}

/**
 * 版本未变则挂起，直到注册表变化或超时。
 *
 * `timeoutMs` 由后端钳制（1–30s，默认 25s）—— 前端**不得**自己写重试循环去凑时长，
 * 那会让「空闲期」变成忙轮询。
 */
export function waitLiveSessions(
  since: number,
  timeoutMs?: number | null,
): Promise<LiveSessionsWait> {
  return invoke<LiveSessionsWait>('wait_live_sessions', {
    since,
    timeoutMs: timeoutMs ?? null,
  });
}

/**
 * 回传会话标题 / 用户提交：CLI 的 `source = 'native'`，或终端用户每次提交的
 * `source = 'prompt'`。
 *
 * - `prompt`：用户提交输入 ⇒ 首次无真标题时按 `Prompt` 命名并标记「已在用」；
 *   后续提交只清除 CLI hook 的权威状态门。空回车同样清除门，但不会写空标题；
 * - `native`：CLI 自报的会话主题 —— 两条来源：hook 面在后端直接调注册表；
 *   终端 OSC 0/2 由 `TerminalViewBase` 的 `onTitleChange` 经本函数上报。
 *
 * `source` **必传**：两端各持一个默认值（前端 `prompt` / 后端 `native`）时，同一个调用的语义
 * 取决于谁在调用 —— 那是两条规则而不是一条。
 *
 * # 判据只在后端，前端只做传输去重
 *
 * 「这条候选配不配当标题」由后端 `live_sessions::title::admit` 唯一裁决：状态栏帧
 * （`π`、`✳ Claude ready`）、身份回显、cwd、`Terminal N` 在那里被判负，注册表不写。
 *
 * 前端**只做两件无语义的事**：与上次上报的原文逐字相同不发、用户首次提交之前不发
 * （都是少发 IPC 的优化 —— 删掉它们行为不变，只是变慢）。
 *
 * 历史：曾因 `π` 覆盖用户首条输入而**整条 OSC 来源被删**。真正的成因是当时没有准入判据
 * （`is_title_material` 是为 `Prompt` 写的，而 `π` 是希腊字母、`✳ Claude ready` 含单词，
 * `char::is_alphanumeric` 全放行）。补上 `admit` 后来源恢复 —— 它也把 `✳ Fix login bug`
 * 这类 provider 自己浓缩过的任务标题带了回来。
 */
/**
 * 这条会话的**原生恢复命令**参数（`["--resume", "<native id>"]`）；`null` = 不支持。
 *
 * 判据在后端：`native_session_id` 只来自 CLI hook，「这个 agent 支不支持原生恢复」由
 * adapter 回答。前端只负责把 args 拼进 `taskCommand`（与 Histor 面板的恢复路径同形），
 * 不维护任何能力表。
 */
export function liveSessionResumeCommand(sessionId: string): Promise<string[] | null> {
  return invoke<string[] | null>('live_session_resume_command', { sessionId });
}

/**
 * 恢复成功后让新会话**继承**旧会话的身份，旧条目退场。
 *
 * 关 tab 只把条目标成 `Stopped`（侧栏那一行留着当「点回来」的入口）；点回来后新 PTY 是
 * 那条会话的延续 —— 继承标题与「已使用」标记，它才会立刻出现在侧栏（否则要等用户敲第一条
 * 输入），同时旧条目让位（否则侧栏挂着「已停止」与「新会话」两行）。
 *
 * 后端只接受**终止态**的 `from`：活着的会话不会被一次点击合并掉。
 */
export function adoptLiveSession(fromSessionId: string, intoSessionId: string): Promise<boolean> {
  return invoke<boolean>('adopt_live_session', { fromSessionId, intoSessionId });
}

export function setLiveSessionTitle(
  sessionId: string,
  title: string,
  source: 'prompt' | 'native',
): Promise<boolean> {
  return invoke<boolean>('set_live_session_title', { sessionId, title, source });
}
