import { reportLiveSessionActivity } from '@/features/live-sessions/api/liveSessionsApi';

import { createUserInputActivityReporter } from './inputTitle';

/**
 * 终端只上报「用户提交过输入」这一事实 —— **终端 I/O 不是标题源**。
 *
 * # 为什么源隔离
 *
 * xterm `onData` 与 OSC 0/2 `onTitleChange` 共用一条通道：TUI 面板里的过滤词
 * （`/model` 里敲 `deep`）、状态栏帧、协议应答都会被 CLI 反射成终端标题栏文本。
 * 旧实现把它们当 `Prompt` / `Native` 标题素材上报，于是「在 /model 里过滤 deep」
 * 会把侧栏会话名写成 `deep`。加黑名单挡不住下一种控件输入，判据也没法区分
 * 「面板过滤词」与「真实请求」—— 唯一正确的修法是**断开 OSC 这条生产者**。
 *
 * # 行文本为什么还在上报
 *
 * 纯 shell（`agent_id = None`）没有 hook / conversation 通道，首条输入行是它唯一的标题
 * 素材。是否采用这行由**后端** `Registry::report_terminal_input` 按 `agent_id` 裁决：
 * 纯 shell 命名，agent 终端一律不命名。前端不做第二套判据 —— 字节形状区分不了
 * 「真实请求」与「TUI 控件输入」，双端各一套必然漂移。
 *
 * 标题的其余来源：用户改名、CLI hook `topic`、conversation 缓存的 provider title、
 * chat 注册的真实 prompt —— 都在后端写注册表，IPC 不接受前端声明 `source`。
 *
 * # 这里只做两件事
 *
 * 1. `createUserInputActivityReporter` 从 `onData` 里认出「用户按了回车」（并丢弃
 *    ESC 协议应答、bracketed paste 标记等传输噪声）；
 * 2. 每次提交发一条 `report_live_session_activity(sessionId, line)` —— 后端置
 *    `has_user_input`、清权威状态门，并按会话类型决定要不要用这行命名。
 *
 * **不订阅 `onTitleChange`**，因此没有订阅需要解绑：句柄只有一个 `reportUserInput`。
 */
export function installTerminalReporting(opts: { getSessionId: () => string | null }): {
  reportUserInput: (text: string) => void;
} {
  const reportUserInput = createUserInputActivityReporter({
    getSessionId: opts.getSessionId,
    report: (sessionId, line) => {
      void reportLiveSessionActivity(sessionId, line).catch((err) =>
        console.warn('[Terminal] 会话活动上报失败:', err),
      );
    },
  });

  return { reportUserInput };
}
