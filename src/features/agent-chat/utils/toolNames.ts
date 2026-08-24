/**
 * 工具名归一化 —— 各 agent 框架的命名差异 → Agent Chat 标准工具名。
 *
 * 历史恢复（historyConvert）与 live 流（useAgentChat 的 tool_start）共用
 * 本表，保证同一工具在两条链路命中同一个 WorkRows 卡片分派
 * （CommandCard / DiffCard / ReadCard 等）。渲染层兜底别名（如 bash、read、
 * task）保留在 WorkRows 分支中，此处只收录「必须改名才能命中分派/计数」的条目。
 */

/** PascalCase（claude-code Bash/Read/Edit）→ 小写 snake，再经别名表对齐卡片分派规则。 */
export function normalizeToolName(name: string): string {
  const snake = name
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
  const aliases: Record<string, string> = {
    exec: 'run_command',
    exec_command: 'run_command',
    shell: 'run_command',
    command: 'run_command',
    terminal: 'run_command',
    edit: 'edit_file',
    // claude-code 实际工具名为 MultiEdit，PascalCase→snake 后是 multi_edit
    multi_edit: 'edit_file',
    multiedit: 'edit_file',
    write: 'write_file',
    read: 'read_file',
  };
  return aliases[snake] ?? snake;
}
