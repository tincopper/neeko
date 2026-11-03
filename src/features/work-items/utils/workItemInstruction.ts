/**
 * 工作项 → **指令前置**（`run-single` 交给 agent 会话的那段上下文）。
 *
 * # 只拼「意图」，不拼「步骤」
 *
 * 这段文字的收件人是一个 agent，不是一段脚本：它拿到的是「要做的事」（标题 / 正文 / 阶段 /
 * 优先级 / 负责人 / 标签 / id），怎么拆、先改哪个文件、要不要写测试**由它自己决定**。
 * 拼步骤会让 `single` 与 `team` 两档失去差别（design §3.4 的三档阶梯按「谁决定下一步」分），
 * 也会让一次探索性执行被一份写死的清单绑住。
 *
 * # 不在这里拼 agent 命令
 *
 * `opencode --prompt '…'` 这种形态由 [`buildAgentPromptCommand`](../../../shared/utils/agentPromptCommand.ts)
 * 负责：命令、前置参数、引号转义都是 **agent 配置** 的投影，与工作项无关。在这里拼一次
 * `--prompt`，就等于给「怎么调一个 agent CLI」造出第二个判据 —— 换一个 agent（不同的
 * `interactive_prompt_args`）时，只有那一条路径会失效，而且失效在运行时。
 *
 * # 谁在用
 *
 * `run-single`（[`useRunSingleWorkItem`](../hooks/useRunSingleWorkItem.ts)）今天用它；
 * `run-team` 落地时**共用这一个函数**（implement.md「同一套『渲染意图』函数」，不要写第二份）。
 * 所以这里只依赖 `WorkItem` 的形状，不接 agent / 终端 / provider 的任何东西。
 */

import type { WorkItem } from '../types';

/** 开场一句：说明这是「一件事」，不是一段命令。不含任何步骤。 */
const INTRO = '请完成下面这个工作项，完成后按你的习惯汇报结果。';

/**
 * 渲染工作项的意图文本。
 *
 * # 空字段整行省略
 *
 * 没有负责人就不写 `负责人：`，没有优先级就不写 `优先级：`。占位文案（`Assignee: (none)`）
 * 是给表单看的，进了 prompt 只会变成一条需要 agent 读一遍再判假的噪声。
 * `标题` / `编号` 是例外：它们由域保证非空（后端拒绝空标题），且是指令的锚点。
 *
 * # 优先级为什么是 `toUpperCase()`
 *
 * 线上值就是 `p1`，展示形态是 `P1` —— 映射是一次恒等的大写化，不需要第二张标签表。
 * （标签表 `PRIORITY_LABEL` 住在 `components/WorkItemChips.tsx`，那是**渲染**的实现；
 * 让纯函数去 import 一个组件文件是反方向的依赖，而在这里复制一张表就是两份会漂移的真相。）
 */
export function renderWorkItemInstruction(item: WorkItem): string {
  const lines: string[] = [INTRO, '', `标题：${item.title}`, `编号：${item.id}`];

  const stage = item.stage.trim();
  if (stage !== '') lines.push(`阶段：${stage}`);

  if (item.priority !== null) lines.push(`优先级：${item.priority.toUpperCase()}`);

  const assignee = (item.assignee ?? '').trim();
  if (assignee !== '') lines.push(`负责人：${assignee}`);

  if (item.labels.length > 0) lines.push(`标签：${item.labels.join(', ')}`);

  // 正文不 trim（首行缩进 / 代码块有意义，与后端「正文不 trim」同口径），只在**全空**时省略。
  if (item.body.trim() !== '') lines.push('', '描述：', item.body);

  return lines.join('\n');
}
