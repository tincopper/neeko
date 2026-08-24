import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { useState } from 'react';

import type { ToolCard } from '../types';

import OutputScroll from './OutputScroll';

interface CommandCardProps {
  tool: ToolCard;
  /** 脚本名称（如 cargo-check.sh）。 */
  scriptName?: string;
  /** 脚本路径（如 /scripts/cargo-check.sh）。 */
  scriptPath?: string;
}

/**
 * 命令展示文本：优先 tool.title（后端已尽量提取完整命令）；
 * 若 title 仍是工具名兜底（bash / run_command），尝试从输出首行的
 * 终端回显 `$ cmd` / `❯ cmd` 提取。
 */
function extractCommand(tool: ToolCard): string {
  const title = tool.title.trim();
  if (title && title !== 'bash' && title !== 'run_command' && title !== tool.name) {
    return title;
  }
  const firstLine = tool.output?.split('\n').find((l) => l.trim());
  const echo = firstLine?.match(/^\s*[$❯>]\s*(.+)$/);
  if (echo) return echo[1].trim();
  return title || tool.name;
}

const STATUS_ICON = {
  running: <Loader2 size={13} className="spin cmd-status-icon" />,
  failed: <X size={13} className="cmd-status-icon" />,
  done: <Check size={13} className="cmd-status-icon" />,
} as const;

/**
 * Codex 风格命令执行块 —— 头部（命令单行截断 + 状态 + 尾部 chevron hover 显示）+
 * 展开体（完整命令回显 + 输出，直接展示、无中间 Result 层）。
 * 由 `command_run` / `bash` 工具卡片驱动。
 */
export default function CommandCard({ tool, scriptName, scriptPath }: CommandCardProps) {
  const [open, setOpen] = useState(tool.status === 'failed');
  const hasOutput = Boolean(tool.output);
  const commandText = extractCommand(tool);

  const head = (
    <button
      type="button"
      className="cmd-head-btn"
      data-testid="command-card-header"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="cmd-prompt" aria-hidden="true">
        bash
      </span>
      {scriptName && <span className="cmd-script-name">{scriptName}</span>}
      {scriptPath && <span className="cmd-script-path">{scriptPath}</span>}
      {!scriptName && !scriptPath && (
        <span className="cmd-text" title={commandText}>
          {commandText}
        </span>
      )}
      <span className="cmd-status">
        {STATUS_ICON[tool.status]}
        <span className="cmd-status-label">{tool.status}</span>
      </span>
      {hasOutput && <ChevronRight size={14} className="chevron" />}
    </button>
  );

  return (
    <div className={`cmd-card ${tool.status}`} data-testid="command-card">
      {hasOutput ? (
        head
      ) : (
        <div className="cmd-head">
          <span className="cmd-prompt" aria-hidden="true">
            bash
          </span>
          {scriptName && <span className="cmd-script-name">{scriptName}</span>}
          {scriptPath && <span className="cmd-script-path">{scriptPath}</span>}
          {!scriptName && !scriptPath && (
            <span className="cmd-text" title={commandText}>
              {commandText}
            </span>
          )}
          <span className="cmd-status">
            {STATUS_ICON[tool.status]}
            <span className="cmd-status-label">{tool.status}</span>
          </span>
        </div>
      )}
      {hasOutput && open && (
        <div className="cmd-body">
          <div className="cmd-full">$ {commandText}</div>
          <OutputScroll text={tool.output!} className="cmd-output" testId="command-output" />
        </div>
      )}
    </div>
  );
}
