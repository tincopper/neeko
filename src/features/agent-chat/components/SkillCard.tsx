import { ChevronRight, FileCode } from 'lucide-react';
import { useState } from 'react';

interface SkillCardProps {
  /** Skill 名称。 */
  name: string;
  /** Skill 文件路径。 */
  filePath: string;
  /** Skill 内容（展开后显示）。 */
  content: string;
  /** 加载状态。 */
  status?: 'loaded' | 'running' | 'done' | 'failed';
}

/**
 * Skill 加载卡片 —— 显示 skill [名称] [文件路径] [状态]，点击展开显示内容。
 * 默认折叠，避免长内容撑开聊天区域。
 */
export default function SkillCard({ name, filePath, content, status = 'loaded' }: SkillCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`skill-card ${status}`} data-testid="skill-card">
      <button
        type="button"
        className="skill-header"
        data-testid="skill-card-header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chevron">
          <ChevronRight size={12} />
        </span>
        <FileCode size={14} className="skill-icon" />
        <span className="skill-type">skill</span>
        <span className="skill-name">{name}</span>
        <span className="skill-path">{filePath}</span>
        <span className="skill-status">{status}</span>
      </button>
      {open && (
        <div className="skill-body" data-testid="skill-body">
          <pre>
            <code>{content}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
