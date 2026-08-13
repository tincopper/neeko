import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { Bug, FileText, GitCommit, Send, Sparkles, User, X } from '@/shared/components/icons';

import { REVIEW_INSTRUCTION_MAX } from './diffViewUtils';

/** 下拉面板宽度。 */
const PANEL_WIDTH = 280;

interface QuickAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** 点击快捷操作时作为 instruction 注入的预设文本。 */
  preset: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'explain',
    label: 'Explain the changes',
    icon: <FileText size={14} />,
    preset: 'Explain the changes in detail.',
  },
  {
    id: 'bugs',
    label: 'Find potential bugs',
    icon: <Bug size={14} />,
    preset: 'Find potential bugs and edge cases.',
  },
  {
    id: 'commit',
    label: 'Generate commit message',
    icon: <GitCommit size={14} />,
    preset: 'Generate a concise commit message for these changes.',
  },
];

interface ReviewInstructionPopoverProps {
  /** 弹层是否可见。 */
  open: boolean;
  /** 锚定元素：提供时弹框 fixed 定位到其下方；否则右上角（全文 review）。 */
  anchorEl?: HTMLElement | null;
  /** 提交：instruction 为空时传 undefined（不注入自定义指令段）。 */
  onSubmit: (instruction?: string) => void;
  /** 关闭弹层（不提交）。 */
  onClose: () => void;
}

/**
 * AI Review 下拉面板（VSCode 风格，全文 review 入口）。
 *
 * 结构：
 * ┌─────────────────────────────┐
 * │ ✨ [输入框................] ↑│  ← 顶部输入行
 * ├─────────────────────────────┤
 * │  Quick actions              │  ← 分组标题
 * │  📄 Explain the changes     │
 * │  🐛 Find potential bugs     │
 * │  📝 Generate commit message │
 * ├─────────────────────────────┤
 * │  👤 Model: Auto             │  ← 底部模型切换
 * └─────────────────────────────┘
 *
 * 空指令提交 = 默认 review（方案 1 的能力）。
 * 注：选区 review 走 SelectionActionBar（inline 输入条），不经过本组件。
 */
const ReviewInstructionPopover: React.FC<ReviewInstructionPopoverProps> = ({
  open,
  anchorEl,
  onSubmit,
  onClose,
}) => {
  const [instruction, setInstruction] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const openKey = useId() + (open ? ':open' : ':closed');

  // 打开时聚焦输入框
  useLayoutEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open, openKey]);

  // 有锚点：fixed 定位到锚点下方，底部溢出时向上展开
  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const update = () => {
      const rect = anchorEl.getBoundingClientRect();
      const gap = 4;
      const el = rootRef.current;
      const elHeight = el?.offsetHeight ?? 0;
      const top =
        rect.bottom + gap + elHeight > window.innerHeight
          ? Math.max(8, rect.top - elHeight - gap)
          : rect.bottom + gap;
      const left = Math.min(
        Math.max(8, rect.right - PANEL_WIDTH),
        window.innerWidth - PANEL_WIDTH - 8,
      );
      setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    };
    update();
    document.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchorEl]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open, onClose]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleSubmit = useCallback(() => {
    const trimmed = instruction.trim();
    onSubmit(trimmed.length > 0 ? trimmed : undefined);
  }, [instruction, onSubmit]);

  const handleQuickAction = useCallback(
    (preset: string) => {
      onSubmit(preset);
    },
    [onSubmit],
  );

  if (!open) return null;

  const anchored = Boolean(anchorEl && pos);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="AI review options"
      className={cn(
        'z-50 w-72 rounded-md border border-border bg-bg-secondary shadow-lg overflow-hidden',
        anchored ? 'fixed' : 'absolute top-2 right-2',
      )}
      style={anchored && pos ? { top: pos.top, left: pos.left } : undefined}
    >
      {/* 顶部输入行 */}
      <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-border/50">
        <Sparkles size={14} className="shrink-0 text-accent-blue" />
        <input
          key={openKey}
          ref={inputRef}
          value={instruction}
          maxLength={REVIEW_INSTRUCTION_MAX}
          placeholder="Review change with AI…"
          aria-label="Review instruction"
          className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <button
          type="button"
          aria-label="Submit review"
          title="Submit (Enter)"
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted',
            'hover:bg-accent-blue/15 hover:text-accent-blue transition-colors',
          )}
          onClick={handleSubmit}
        >
          <Send size={13} />
        </button>
        <button
          type="button"
          aria-label="Close review options"
          title="Close (Esc)"
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted',
            'hover:bg-bg-hover hover:text-text-primary transition-colors',
          )}
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      {/* 快捷操作分组 */}
      <div className="py-1">
        <div className="px-2.5 py-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Quick actions
        </div>
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            onClick={() => handleQuickAction(action.preset)}
          >
            <span className="w-4 text-accent-blue flex items-center justify-center shrink-0">
              {action.icon}
            </span>
            <span className="flex-1">{action.label}</span>
          </button>
        ))}
      </div>

      {/* 底部模型切换 */}
      <div className="border-t border-border/50 py-1">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          title="Switch model"
        >
          <span className="w-4 text-text-muted flex items-center justify-center shrink-0">
            <User size={14} />
          </span>
          <span className="flex-1">
            Model: <span className="text-text-primary font-medium">Auto</span>
          </span>
        </button>
      </div>
    </div>
  );
};

export default ReviewInstructionPopover;
