import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { useImeSpaceGuard } from '@/shared/hooks/useImeSpaceGuard';

import { noAutocorrectProps } from './inputDefaults';

/**
 * 输入框的尺寸变体。
 *
 * # 为什么需要 `size` 而不是让调用方写 `className="h-7 …"`
 *
 * 本项目大量表格行内编辑需要紧凑输入框。它们此前绕开本组件、裸写 `<input>`，
 * 于是**连带丢掉了组件内部的三重保护**：IME 分词空格守卫、`noAutocorrectProps`
 * （WebKit 自动大写/纠错/拼写）、统一的 focus 样式。
 *
 * 让尺寸成为**变体**，那些调用点就有了一条既能改尺寸、又能继承保护的复用路径。
 * 类合并交给 `cn`（tailwind-merge 会按后写覆盖前写的规则消解冲突）。
 */
const inputVariants = cva(
  [
    'w-full bg-bg-primary border border-border rounded-md',
    'text-text-primary font-mono',
    'outline-none transition-colors duration-200',
    'focus:border-accent-blue focus:ring-2 focus:ring-accent-blue',
    'placeholder:text-text-muted',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  ].join(' '),
  {
    variants: {
      /** `sm` = 表格行内 / 密集表单；`default` = 常规表单字段。 */
      size: {
        default: 'px-3 py-2.5 text-[var(--font-size)]',
        sm: 'h-7 px-2 py-0 text-[0.82em]',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

export interface InputProps
  extends Omit<React.ComponentProps<'input'>, 'size' | 'ref'>, VariantProps<typeof inputVariants> {}

/**
 * 统一输入框。
 *
 * `forwardRef` 不是可选装饰：行内编辑类组件（`InlineRenameInput`）要在**挂载时**自己
 * focus + select，而它们必须复用本组件才能继承 IME 空格守卫 / WebKit 关断属性 /
 * 统一 focus 样式 —— 没有 ref 就只能退回裸 `<input>` 再丢一遍保护。
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size, onCompositionEnd, ...props },
  ref,
) {
  const guard = useImeSpaceGuard<HTMLInputElement>();
  return (
    <input
      ref={ref}
      data-slot="input"
      {...noAutocorrectProps}
      className={cn(
        inputVariants({ size }),
        // Hide number spinners
        '[&[type=number]]:[-moz-appearance:textfield]',
        '[&[type=number]]:[&::-webkit-inner-spin-button]:appearance-none',
        '[&[type=number]]:[&::-webkit-outer-spin-button]:appearance-none',
        className,
      )}
      onCompositionEnd={(e) => {
        guard.onCompositionEnd(e);
        onCompositionEnd?.(e);
      }}
      {...props}
    />
  );
});
Input.displayName = 'Input';

function Textarea({ className, onCompositionEnd, ...props }: React.ComponentProps<'textarea'>) {
  const guard = useImeSpaceGuard<HTMLTextAreaElement>();
  return (
    <textarea
      data-slot="textarea"
      {...noAutocorrectProps}
      className={cn(
        'w-full px-3 py-2.5 bg-bg-primary border border-border rounded-md',
        'text-text-primary text-[var(--font-size)] font-mono',
        'outline-none transition-colors duration-200',
        'focus:border-accent-blue focus:ring-2 focus:ring-accent-blue',
        'placeholder:text-text-muted',
        'resize-y min-h-[80px]',
        className,
      )}
      onCompositionEnd={(e) => {
        guard.onCompositionEnd(e);
        onCompositionEnd?.(e);
      }}
      {...props}
    />
  );
}

export { Input, Textarea };
