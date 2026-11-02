import type { AgentConfig } from '@/shared/types';

/**
 * argv → **一段交给平台 shell 执行的命令文本**的唯一拼装处。
 *
 * # 为什么必须加引号
 *
 * 终端里执行的不是 argv，而是 shell 解释过的字符串（后端按平台选 `cmd /c` / `sh -c`，
 * 见红线 2）。参数含空白时（`--mcp 'my server'`），裸空格拼接会把一个参数拆成两个 ——
 * 表现为「agent 起来了，但某个配置项莫名其妙」。
 *
 * # 引号约定
 *
 * 未加引号的安全集与 POSIX `shlex.quote` 一致；越界者一律单引号包裹，内部 `'` 转义为
 * `'\''`。这套约定由 `buildAgentPromptCommand` 先立、此处收编（同一份转义只允许一处实现）。
 * Windows `cmd` 的引号体系另有一套 —— 平台差异在后端，不在这里分叉。
 */
const SAFE_SHELL_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * 单个参数的安全形态：无需引号就原样返回，否则用单引号包裹。
 *
 * 空串**必须**保留为 `''`（`git commit -m ""` 是合法调用），不能被过滤掉。
 */
export function quoteShellValue(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 参数（argv 语义）：安全集内不加引号，越界者按 `quoteShellValue` 包裹。
 *
 * 与 [`quoteShellValue`] 分开是因为**位置参数**（prompt）与**选项参数**的既有约定不同：
 * prompt 一直带引号（它可以含任意字符，且历史上就这么拼），改动它只会制造无谓的 diff。
 */
export function quoteShellArg(arg: string): string {
  if (SAFE_SHELL_ARG.test(arg)) return arg;
  return quoteShellValue(arg);
}

/** 逐 token 加引号后拼成一行（argv 的边界不丢）—— 模块私有：对外给的是语义化的两个入口。 */
function shellJoin(argv: readonly string[]): string {
  return argv.map(quoteShellArg).join(' ');
}

/**
 * 原生恢复命令：`<agent.command> <agent.args…> <resumeArgs…>`。
 *
 * 两个恢复入口（Histor 面板 / 侧栏「点回来」）必须拼出**同一条**命令：能力由 adapter
 * 回答（`--resume <id>` / `resume <id>` …），拼装方式不该各写一份。
 */
export function buildResumeTaskCommand(
  agent: Pick<AgentConfig, 'command' | 'args'>,
  resumeArgs: readonly string[],
): string {
  return shellJoin([agent.command, ...agent.args, ...resumeArgs]);
}

/** 纯参数拼接（无 prompt）：`<command> <args…>` —— 自动拉起 agent 时的唯一入口。 */
export function buildAgentCommand(agent: Pick<AgentConfig, 'command' | 'args'>): string {
  return shellJoin([agent.command, ...agent.args]);
}
