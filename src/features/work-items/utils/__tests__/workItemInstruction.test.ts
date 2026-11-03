// @vitest-environment node
/**
 * `renderWorkItemInstruction`：工作项 → 指令前置的**纯函数**（仓库红线：纯函数 100%）。
 *
 * 断言只钉两件事，别的一律不测：
 * 1. **意图字段齐全、空字段整行省略**（占位文案进了 prompt 只是一条要 agent 读一遍再判假的噪声）；
 * 2. 正文里的特殊字符经整条链路（本函数 → `buildAgentPromptCommand`）仍然是**一条安全命令**。
 *
 * 第 2 条不是在测本函数：转义属于 `buildAgentPromptCommand`。放在这里是因为它是「工作项里
 * 用户随手写下的单引号会不会让执行失败」这个问题的唯一可测形态 —— 只看本函数的输出，
 * 单引号原样保留是**正确**的；只看 builder，又不知道用户会写什么。
 */
import { describe, expect, it } from 'vitest';

import { buildAgentPromptCommand } from '@/shared/utils/agentPromptCommand';

import type { WorkItem } from '../../types';
import { renderWorkItemInstruction } from '../workItemInstruction';

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi_1',
    projectId: 'p1',
    title: '修复登录态过期',
    body: '第一行\n第二行',
    stage: 'In Progress',
    priority: 'p1',
    labels: ['bug', 'auth'],
    assignee: 'tincopper',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('renderWorkItemInstruction', () => {
  it('全字段：标题 / 编号 / 阶段 / 优先级 / 负责人 / 标签 / 描述逐行给出', () => {
    expect(renderWorkItemInstruction(item())).toBe(
      [
        '请完成下面这个工作项，完成后按你的习惯汇报结果。',
        '',
        '标题：修复登录态过期',
        '编号：wi_1',
        '阶段：In Progress',
        '优先级：P1',
        '负责人：tincopper',
        '标签：bug, auth',
        '',
        '描述：',
        '第一行',
        '第二行',
      ].join('\n'),
    );
  });

  it('空正文 / 无优先级 / 无负责人 / 无标签 / 空 stage：整行省略，不留占位噪声', () => {
    const rendered = renderWorkItemInstruction(
      item({ body: '', priority: null, assignee: null, labels: [], stage: '   ' }),
    );

    expect(rendered).toBe(
      [
        '请完成下面这个工作项，完成后按你的习惯汇报结果。',
        '',
        '标题：修复登录态过期',
        '编号：wi_1',
      ].join('\n'),
    );
    // 占位文案的形态（`(none)` / `未设置` / 空 `描述：`）一个都不许出现。
    expect(rendered).not.toContain('描述');
    expect(rendered).not.toContain('负责人');
    expect(rendered).not.toContain('优先级');
    expect(rendered).not.toContain('标签');
    expect(rendered).not.toContain('阶段');
  });

  it('纯空白的负责人与正文按「没有」处理（不是只有空串才算空）', () => {
    const rendered = renderWorkItemInstruction(
      item({ body: '  \n\t ', assignee: '   ', labels: [] }),
    );

    expect(rendered).not.toContain('负责人');
    expect(rendered).not.toContain('描述');
  });

  it('正文**不 trim**：首行缩进与代码块原样进 prompt', () => {
    const body = '  缩进的一行\n```ts\nconst a = 1;\n```';
    const rendered = renderWorkItemInstruction(item({ body }));

    expect(rendered.endsWith(`描述：\n${body}`)).toBe(true);
  });

  it('单引号正文经整条链路仍然是安全的一条命令（转义在 buildAgentPromptCommand）', () => {
    const body = "It's a trap: rm -rf '/tmp/x'";
    const prompt = renderWorkItemInstruction(item({ body, labels: [] }));
    const command = buildAgentPromptCommand(
      { command: 'opencode', prompt_args: null, interactive_prompt_args: ['--prompt'] },
      prompt,
    );

    // 提示本身原样保留（纯函数不该在这里改写用户的正文）。
    expect(prompt).toContain(body);
    // 命令里没有任何一个**裸**单引号能提前闭合 prompt：每个 `'` 都以 `'\''` 形态出现。
    expect(command.startsWith("opencode --prompt '")).toBe(true);
    expect(command.endsWith("'")).toBe(true);
    const quoted = command.slice("opencode --prompt '".length, -1);
    expect(quoted).toBe(prompt.replace(/'/g, `'\\''`));
    // 反向判据：把未转义的 prompt 塞进同一壳层会被拆成多个参数。
    expect(quoted).not.toBe(prompt);
  });
});
