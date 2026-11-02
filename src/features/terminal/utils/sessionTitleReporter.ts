import { setLiveSessionTitle } from '@/features/live-sessions/api/liveSessionsApi';

import { createUserInputActivityReporter } from './inputTitle';

/**
 * CLI 自报的终端标题（OSC 0/2）→ 注册表 `Native` 来源的上报闸门。
 *
 * # 判据不在这里
 *
 * 「这条标题配不配当会话名」由后端 `live_sessions::title::admit` 唯一裁决：状态栏帧
 * （`π`、`✳ Claude ready`）、身份回显、cwd 形态、`Terminal N` 在那里被判负，注册表
 * 什么都不写。前端不剥装饰、不过滤、不判负 —— 双端各一套黑名单必然漂移
 * （`π` 那次事故的代价正是整条来源被删掉）。
 *
 * # 这里只有两件**无语义**的传输优化
 *
 * 1. **首次提交前不发**：CLI 一启动就刷 cwd / 品牌名，那些时刻的标题不是会话主题；
 * 2. **归一后去重**：CLI 每帧重绘都会触发 `onTitleChange`，而 spinner 帧之间只有字形
 *    不同（`⠋ fix bug` → `⠙ fix bug`）。逐字比较会把每一帧都当成新标题 —— 每帧一次
 *    IPC，而它们去重后其实是同一句话。
 *
 * 两者都是「删掉行为不变、只是变慢」的优化，不是判据 —— 这条区分写在这里是因为它决定了
 * 将来能不能安全地删：判据删了会出错，优化删了只是多几个 IPC。
 */
export interface SessionTitleReporter {
  /** 用户提交过一次输入（由 `createUserInputActivityReporter` 的回调驱动）。 */
  markUserInput: () => void;
  /** 喂一个 OSC 标题（`term.onTitleChange` 的原样字符串）。 */
  report: (title: string) => void;
}

/**
 * 去重键：**只喂去重槽位，不参与判据**。
 *
 * 去掉装饰字形与空白差异（`⠋ fix bug` ≡ `⠙ fix bug`），保留字母 / 数字 —— 于是
 * 「换了个 spinner」不算新标题，而「换了任务」仍然算。
 */
function dedupeKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function createSessionTitleReporter(opts: {
  getSessionId: () => string | null;
  send: (sessionId: string, title: string) => void;
}): SessionTitleReporter {
  let userHasSubmitted = false;
  let lastReportedKey: string | null = null;

  return {
    markUserInput(): void {
      userHasSubmitted = true;
    },
    report(title: string): void {
      // 优化 1：还没人用过这条会话 ⇒ CLI 的标题栏与「这次会话在做什么」无关。
      if (!userHasSubmitted) return;
      // 优化 2：归一后与上次相同（含空白 / spinner 字形差异）⇒ 不发。
      // 空键（纯符号帧）同样不发：它不是素材，也不该占住去重槽位。
      const key = dedupeKey(title);
      if (!key || key === lastReportedKey) return;
      const sessionId = opts.getSessionId();
      if (!sessionId) return;
      lastReportedKey = key;
      opts.send(sessionId, title.trim());
    },
  };
}

/**
 * 标题上报的唯一出口：失败不影响终端运行，但**不静默** —— 这条通道漏了的表现是
 * 「输入后侧栏一直不出现会话」，排障需要一个可见线索（旧构建缺命令就栽在这）。
 */
function sendTitle(sessionId: string, title: string, source: 'prompt' | 'native'): void {
  const label = source === 'native' ? 'CLI 标题' : '会话标题';
  void setLiveSessionTitle(sessionId, title, source).catch((err) =>
    console.warn(`[Terminal] ${label}上报失败:`, err),
  );
}

/**
 * 装好终端的两条上报通道：CLI 自报标题（OSC 0/2）与用户输入（活动 + `Prompt` 素材）。
 *
 * 它们必须**同装同卸**：`markUserInput` 是 OSC 标题那道闸门的开闸点，少装一条的后果是
 * 「终端能跑但侧栏永远不出现会话」，而两条各自 `dispose` 的后果是 xterm / 事件表里留死闭包。
 * 组件侧只持有一个 `dispose` 句柄 —— 挂到缓存条目的 `unlisten` 槽位即可。
 *
 * IPC 调用与失败日志收在本模块：它是「标题 → 注册表」这条通道的唯一所有者，
 * 调用点不该各写一份 `.catch(console.warn)`。
 */
export function installTerminalReporting(opts: {
  term: { onTitleChange: (listener: (title: string) => void) => { dispose: () => void } };
  getSessionId: () => string | null;
}): { reportUserInput: (text: string) => void; dispose: () => void } {
  const reporter = createSessionTitleReporter({
    getSessionId: opts.getSessionId,
    send: (sessionId, title) => sendTitle(sessionId, title, 'native'),
  });
  const subscription = opts.term.onTitleChange(reporter.report);

  // 每次提交都上报：首次提供标题素材，后续清除后端的权威状态门；同时开闸放行 OSC 标题。
  const reportUserInput = createUserInputActivityReporter({
    getSessionId: opts.getSessionId,
    report: (sessionId, line) => {
      reporter.markUserInput();
      sendTitle(sessionId, line, 'prompt');
    },
  });

  return { reportUserInput, dispose: () => subscription.dispose() };
}
