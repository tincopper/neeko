import React, { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { CloseIcon } from '@/shared/components/icons';

import { REVIEW_INSTRUCTION_MAX } from './diffViewUtils';

interface SelectionActionBarProps {
  selectedCount: number;
  /** 提交选区 review；instruction 为空时传 undefined。 */
  onSubmit: (instruction?: string) => void;
  /** 关闭（清除选区）。 */
  onClose: () => void;
}

/**
 * 选中块末尾的 inline 输入条（VSCode "Modify selected code" 风格）。
 * 直接嵌在 diff 表格的跨列行内，随选中行滚动。
 *
 * 布局：左侧竖排按钮（提交↑ / 关闭✕）→ 蓝色指示线 → 输入框 + 底部辅助行。
 */
const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
  selectedCount,
  onSubmit,
  onClose,
}) => {
  const [instruction, setInstruction] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 出现时自动聚焦（VSCode 同款行为）。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = instruction.trim();
    onSubmit(trimmed.length > 0 ? trimmed : undefined);
  }, [instruction, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [handleSubmit, onClose],
  );

  return (
    <div className="relative border-y border-accent-blue bg-bg-secondary px-3 py-2">
      {/* 左侧蓝色指示线（按钮组与输入区之间） */}
      <div className="absolute left-[44px] top-2 bottom-2 w-[2px] rounded-[1px] bg-accent-blue" />

      {/* 主行：左侧竖排按钮 + 输入框 */}
      <div className="flex items-start gap-2">
        {/* 左侧竖排按钮组 */}
        <div className="flex flex-col items-center gap-1 w-7 shrink-0">
          <button
            type="button"
            aria-label="Submit review"
            title="Submit review (Enter)"
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded text-text-muted',
              'hover:bg-bg-hover/80 hover:text-text-primary transition-colors',
            )}
            onClick={handleSubmit}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Close review bar"
            title="Close (Esc)"
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded text-text-muted',
              'hover:bg-bg-hover/80 hover:text-text-primary transition-colors',
            )}
            onClick={onClose}
          >
            <CloseIcon size={14} />
          </button>
        </div>

        {/* 输入框 */}
        <input
          ref={inputRef}
          value={instruction}
          maxLength={REVIEW_INSTRUCTION_MAX}
          placeholder={`Review ${selectedCount} selected line${selectedCount === 1 ? '' : 's'}…`}
          aria-label="Review instruction"
          className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted leading-6 pt-0.5"
          style={{ caretColor: 'var(--color-accent-blue)' }}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
};

export default React.memo(SelectionActionBar);
