/** LSP 状态栏的纯装饰图标（无业务状态）。 */

import { cn } from '@/lib/utils';

export function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      className={cn(
        'w-2.5 h-2.5 shrink-0 text-text-muted transition-transform duration-200',
        open ? 'rotate-180' : 'rotate-0',
      )}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  );
}

export function ChevronRight() {
  return (
    <svg
      className="w-2.5 h-2.5 shrink-0 text-text-muted"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M4.5 3L7.5 6L4.5 9" />
    </svg>
  );
}
