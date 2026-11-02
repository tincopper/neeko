import React from 'react';

import { cn } from '@/lib/utils';

interface InlineRenameInputProps {
  /** 输入框 ref（由调用方的行状态持有，进入编辑态即聚焦全选）。 */
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** 覆盖字号 / 字重这类**行级**排版（侧栏会话行比单元行小一档）。 */
  className?: string;
}

/**
 * **行内重命名输入框** —— worktree 行（本地侧栏 + WSL/SSH 侧栏）与侧栏会话行共用。
 *
 * 与共享的 `DeleteConfirmDialog` 同理：这段 JSX（含 Enter/Escape/blur 三个键路与
 * 「点击不要冒泡成选中行」）曾在两个列表各写一份。行为细节多、易漂移 —— 例如漏掉
 * `stopPropagation` 会让点输入框触发该行「打开终端」，而两份里只改一处时另一域照旧。
 */
const InlineRenameInput: React.FC<InlineRenameInputProps> = ({
  inputRef,
  value,
  onChange,
  onCommit,
  onCancel,
  className,
}) => (
  <input
    ref={inputRef}
    className={cn(
      'w-full bg-bg-tertiary border border-accent-blue rounded text-text-primary text-[var(--font-size)] font-semibold px-1 py-0.5 outline-none box-border',
      className,
    )}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onBlur={onCommit}
    onKeyDown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCommit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }}
    onClick={(e) => e.stopPropagation()}
    onDoubleClick={(e) => e.stopPropagation()}
  />
);

export default React.memo(InlineRenameInput);
