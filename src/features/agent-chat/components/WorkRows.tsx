import { Check, ChevronRight, Eye, Loader2, Pencil, Terminal, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import type { ToolCard } from '../types';
import { chunkToolGroups, type ToolGroup } from '../utils/toolCallGroup';

import CommandCard from './CommandCard';
import DiffCard from './DiffCard';
import OutputScroll from './OutputScroll';
import ReadCard from './ReadCard';
import SkillCard from './SkillCard';
import TaskCard from './TaskCard';
import ToolGroupSummaryRow from './ToolCallGroupSummaryRow';

export function toolIconFor(name: string): ReactNode {
  if (name === 'read_file' || name === 'search' || name === 'grep') return <Eye size={14} />;
  if (name === 'edit_file' || name === 'write_file') return <Pencil size={14} />;
  return <Terminal size={14} />;
}

export function toolStatusLabel(status: ToolCard['status']): string {
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  return 'completed';
}

/** 从命令字符串中提取脚本名称和路径。 */
function parseScriptInfo(cmd: string): { scriptName?: string; scriptPath?: string } | undefined {
  // 匹配 "bash scripts/cargo-check.sh" 或 "bash /path/to/script.sh"
  const match = cmd.match(/^bash\s+(\S+)$/);
  if (!match) return undefined;
  const fullPath = match[1];
  const lastSlash = fullPath.lastIndexOf('/');
  if (lastSlash < 0) return { scriptName: fullPath };
  return {
    scriptName: fullPath.slice(lastSlash + 1),
    scriptPath: fullPath,
  };
}

/** 从 skill 标题或输出中提取 skill 名称和路径。 */
function parseSkillInfo(tool: ToolCard): { name: string; filePath: string } | undefined {
  // 匹配 "skill: codebase-design (.grok/skills/codebase-design/SKILL.md)"
  const titleMatch = tool.title.match(/^skill:\s*(.+?)\s*\((.+?)\)$/);
  if (titleMatch) {
    return { name: titleMatch[1], filePath: titleMatch[2] };
  }
  // 从输出内容中提取 <skill_content name="xxx"> 的 name 属性
  if (tool.output) {
    const outputMatch = tool.output.match(/<skill_content\s+name="([^"]+)"/);
    if (outputMatch) {
      return { name: outputMatch[1], filePath: '' };
    }
  }
  return undefined;
}

/** 单个工具行：skill 卡 / 命令卡 / 文件卡 / task 卡 / 通用行。 */
function ToolRow({
  tool,
  onOpenFile,
}: {
  tool: ToolCard;
  onOpenFile?: (filePath: string) => void;
}) {
  // Skill 加载 → SkillCard（支持 load_skill 和 skill 两种工具名）
  if (tool.name === 'load_skill' || tool.name === 'skill') {
    const info = parseSkillInfo(tool);
    if (info) {
      return (
        <SkillCard
          name={info.name}
          filePath={info.filePath}
          content={tool.output ?? ''}
          status={
            tool.status === 'failed' ? 'failed' : tool.status === 'running' ? 'running' : 'done'
          }
        />
      );
    }
  }

  // 命令执行 → CommandCard（带 scriptName/scriptPath）
  if (tool.name === 'run_command' || tool.name === 'bash') {
    const scriptInfo = parseScriptInfo(tool.title);
    return <CommandCard tool={tool} {...scriptInfo} />;
  }

  // General Task → TaskCard
  if (tool.name === 'task') {
    return <TaskCard tool={tool} />;
  }

  // 文件读取 → ReadCard（默认折叠，折叠标题 `read <路径>`，展开看内容）
  if (tool.name === 'read_file' || tool.name === 'read')
    return <ReadCard tool={tool} onOpenFile={onOpenFile} />;

  // 文件编辑 → DiffCard（独立 diff 卡片，对比高亮）
  if (tool.name === 'edit_file' || tool.name === 'write_file') return <DiffCard tool={tool} />;

  // todowrite 的进度由消息级 TodoListCard 展示，避免单行重复。
  if (tool.name === 'todowrite') return null;

  return <CollapsibleToolRow tool={tool} onOpenFile={onOpenFile} />;
}

/**
 * 通用工具行的一体化折叠形态：命令/标题（头部，含状态）+ 可折叠输出（body）。
 * 命令、执行状态、输出内容同属一个块 —— 与 CommandCard 同构，消灭
 * 「命令一行、输出一行」的分离渲染。failed 默认展开便于立即看到错误。
 */
function CollapsibleToolRow({
  tool,
  onOpenFile,
}: {
  tool: ToolCard;
  onOpenFile?: (filePath: string) => void;
}) {
  const [open, setOpen] = useState(tool.status === 'failed' && Boolean(tool.output));
  const [resultOpen, setResultOpen] = useState(true);
  const hasOutput = Boolean(tool.output);
  void onOpenFile;
  return (
    <div className={`work-row collapsible${open ? ' open' : ''} ${tool.status}`}>
      <button
        type="button"
        className="work-row-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w-icon">
          {tool.status === 'running' ? (
            <Loader2 size={14} className="spin" />
          ) : tool.status === 'failed' ? (
            <X size={14} />
          ) : (
            toolIconFor(tool.name)
          )}
        </span>
        <span className="w-name">{tool.name}</span>
        <span className="w-text" title={tool.title}>
          {tool.title || tool.name}
        </span>
        <span className="w-meta">{toolStatusLabel(tool.status)}</span>
        {hasOutput && <ChevronRight size={14} className="chevron" />}
      </button>
      {hasOutput && open && (
        <div className="cmd-body">
          <button
            type="button"
            className="result-bar"
            aria-expanded={resultOpen}
            onClick={() => setResultOpen((v) => !v)}
          >
            <span className={`result-icon ${tool.status === 'failed' ? 'err' : 'ok'}`}>
              {tool.status === 'failed' ? <X size={11} /> : <Check size={11} />}
            </span>
            <span className="result-label">{tool.status === 'failed' ? 'Error' : 'Result'}</span>
            {tool.output && (
              <span className="result-preview">
                {tool.output.slice(0, 80)}
                {tool.output.length > 80 ? '…' : ''}
              </span>
            )}
          </button>
          {resultOpen && tool.output && (
            <OutputScroll text={tool.output} className="cmd-output" testId="work-row-output" />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 工具调用行列表 —— 对齐原型 `agent-chat-v2.html` 的 `.work-rows`：
 * 图标（按工具名）+ mono 文本 + 状态 meta。消息体与 worked-card 复用。
 * 命令执行（run_command / bash）→ Codex 风格终端块（CommandCard，命令 + 结果）；
 * 文件读取（read_file / read）→ ReadCard（默认折叠，`read <路径>`，展开看内容）；
 * 文件编辑（edit_file / write_file）→ DiffCard（独立 diff 卡片，对比高亮）。
 * 连续的工具调用自动聚合为可折叠摘要（对齐 Synara §14.2.3）。
 * 分组展开直接渲染组内原始工具行（不二次分组，避免递归折叠）。
 */
export interface WorkRowsProps {
  tools: ToolCard[];
  /** read 路径点击回调（透传给 ReadCard，跳转编辑器打开文件）。 */
  onOpenFile?: (filePath: string) => void;
}

export default function WorkRows({ tools, onOpenFile }: WorkRowsProps) {
  const groups = chunkToolGroups(tools);

  return (
    <div className="work-rows">
      {groups.map((item, i) => {
        // 分组折叠
        if ('tools' in item && 'summary' in item) {
          const group = item as ToolGroup;
          return (
            <ToolGroupSummaryRow key={`g${i}`} summary={group.summary} defaultOpen={true}>
              {group.tools.map((t) => (
                <ToolRow key={t.callId} tool={t} onOpenFile={onOpenFile} />
              ))}
            </ToolGroupSummaryRow>
          );
        }
        // 单个工具
        const t = item as ToolCard;
        return <ToolRow key={t.callId} tool={t} onOpenFile={onOpenFile} />;
      })}
    </div>
  );
}
