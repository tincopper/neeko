import React, { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import { Input } from '@/ui/Input';

interface InlineRenameInputProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** 覆盖字号 / 字重这类**行级**排版（侧栏会话行比单元行小一档）。 */
  className?: string;
}

/**
 * **行内重命名输入框** —— worktree 行（本地侧栏 + WSL/SSH 侧栏）、侧栏会话行与 tag group 行共用。
 *
 * 与共享的 `DeleteConfirmDialog` 同理：这段 JSX（含 Enter/Escape/blur 三个键路与
 * 「点击不要冒泡成选中行」）曾在两个列表各写一份。行为细节多、易漂移 —— 例如漏掉
 * `stopPropagation` 会让点输入框触发该行「打开终端」，而两份里只改一处时另一域照旧。
 *
 * **focus + 全选归这里，不归调用方**（2026-11-05），三个理由：
 *
 * 1. 它是「行内重命名」这个行为的一部分，不是某一行的排版偏好；
 * 2. 调用方曾各自持有一份 `useEffect(() => { focus(); select(); }, […])`，第一份就漂移成了
 *    依赖 `[draft]` —— 每敲一个字符就重新全选，下一次按键覆盖整段（表现为「一输入就是
 *    选中状态，只能打出最后一个字」）；
 * 3. 依赖保持 `[]`（**只在挂载时一次**）才是正确语义：编辑态由父级「挂载 / 卸载」表达，
 *    不需要、也不允许对草稿变化做出反应。改名这一条用例钉在
 *    `__tests__/InlineRenameInput.test.tsx`（逐字符 `userEvent.type`）。
 *
 * 渲染走统一的 `ui/Input size="sm"`：顺带继承 IME 分词空格守卫、`noAutocorrectProps`
 * （WebKit 自动大写 / 纠错 / 拼写）与统一 focus 样式。行级排版用 `className` 覆盖，
 * 不改 `Input` 的通用样式。
 */
const InlineRenameInput: React.FC<InlineRenameInputProps> = ({
  value,
  onChange,
  onCommit,
  onCancel,
  className,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // 只在挂载时一次：编辑态的生命周期就是「挂载 → 卸载」。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  return (
    <Input
      ref={inputRef}
      size="sm"
      className={cn(
        // 行内观感：压到行高、去掉默认的横向内边距；`font-sans` 覆盖 `Input` 的等宽字体，
        // `text-[var(--font-size)]` 覆盖 `sm` 变体的小字号（行内编辑读的是名字，不是表单值）。
        // `cn` 必须保留：tailwind-merge 才是「后写覆盖前写」；CSS 里同权重类的先后与
        // className 字符串顺序无关。
        'h-6 min-w-0 flex-1 px-1 font-sans text-[var(--font-size)] font-semibold box-border',
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
};

export default React.memo(InlineRenameInput);
