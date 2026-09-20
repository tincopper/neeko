// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildAgentPromptCommand } from '../agentPromptCommand';

const agent = (partial: {
  command?: string;
  prompt_args?: string[] | null;
  interactive_prompt_args?: string[] | null;
  post_prompt_args?: string[] | null;
}) => ({
  command: 'agent-cli',
  prompt_args: null,
  interactive_prompt_args: null,
  post_prompt_args: null,
  ...partial,
});

describe('buildAgentPromptCommand（agent CLI prompt 命令，数据驱动）', () => {
  it('交互式形态优先：opencode interactive_prompt_args=["--prompt"] → opencode --prompt …', () => {
    const cmd = buildAgentPromptCommand(
      agent({
        command: 'opencode',
        // headless 形态（AI commit 等用）—— 交互式已声明时不被消费
        prompt_args: ['run', '--pure', '--dangerously-skip-permissions=true', '-f'],
        interactive_prompt_args: ['--prompt'],
      }),
      'fix the following problem',
    );
    expect(cmd).toBe("opencode --prompt 'fix the following problem'");
  });

  it('无交互式声明时回落 headless prompt_args（去 -f，prompt 作位置参数）', () => {
    const cmd = buildAgentPromptCommand(
      agent({ command: 'opencode', prompt_args: ['run', '--pure', '-f'] }),
      'fix it',
    );
    expect(cmd).toBe("opencode run --pure 'fix it'");
  });

  it('claude：--bare -p + post args 拼在 prompt 后', () => {
    const cmd = buildAgentPromptCommand(
      agent({
        command: 'claude',
        prompt_args: ['--bare', '-p'],
        post_prompt_args: ['--dangerously-skip-permissions'],
      }),
      'explain this',
    );
    expect(cmd).toBe("claude --bare -p 'explain this' --dangerously-skip-permissions");
  });

  it('codex：prompt_args 为空 → prompt 作唯一位置参数', () => {
    const cmd = buildAgentPromptCommand(agent({ command: 'codex', prompt_args: [] }), 'hi');
    expect(cmd).toBe("codex 'hi'");
  });

  it('prompt 内单引号按 sh 语义转义', () => {
    const cmd = buildAgentPromptCommand(
      agent({ command: 'gemini', prompt_args: ['--prompt'] }),
      "it's broken",
    );
    expect(cmd).toBe("gemini --prompt 'it'\\''s broken'");
  });

  it('F4 · prompt 含空格/双引号/单引号：sh 单引号包裹，双引号原样保留', () => {
    // 拼装层只做 sh 转义；Windows 下 `cmd /c` 执行分支由 terminal/manager 经
    // `platform::shell_launch::build_task_command` 区分（Rust 侧单测已钉死），
    // 不在拼装层打补丁 —— 本用例锁定 sh 语义不漂移。
    const cmd = buildAgentPromptCommand(
      agent({ command: 'opencode', interactive_prompt_args: ['--prompt'] }),
      'fix "foo" and it\'s at main.go:1-1',
    );
    expect(cmd).toBe(`opencode --prompt 'fix "foo" and it'\\''s at main.go:1-1'`);
  });
});
