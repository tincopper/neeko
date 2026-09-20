import type { AgentConfig } from '@/shared/types';

/**
 * 构建 agent CLI 的 prompt 命令，用于诊断 AI 动作在打开的终端里执行。
 *
 * 两种形态由 `AgentConfig` **数据承载**（不做 agent 特判）：
 * - **交互式（TUI）**：`interactive_prompt_args`，如 opencode `["--prompt"]` →
 *   `opencode --prompt '<prompt>'`（打开 CLI 并预填 prompt，用户可见、可继续对话）；
 * - **Headless**：`prompt_args`（如 AI commit 用的 `run --pure … -f`），后台一次性执行。
 *
 * 终端场景优先交互式形态；未声明（`None`）则回落到 headless `prompt_args`。
 * `-f`（文件模式）在内联场景去掉，prompt 作位置参数直接传。
 */
export function buildAgentPromptCommand(
  agent: Pick<
    AgentConfig,
    'command' | 'prompt_args' | 'post_prompt_args' | 'interactive_prompt_args'
  >,
  prompt: string,
): string {
  const escaped = prompt.replace(/'/g, `'\\''`);
  const args = agent.interactive_prompt_args ?? agent.prompt_args ?? [];
  const post = (agent.post_prompt_args ?? []).join(' ');
  const inlineArgs = args.filter((arg) => arg !== '-f').join(' ');
  return [agent.command, inlineArgs, `'${escaped}'`, post].filter(Boolean).join(' ');
}
