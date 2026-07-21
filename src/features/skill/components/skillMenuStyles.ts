import { cn } from '@/lib/utils';

/** Theme-aligned dropdown panel (matches project ContextMenu, not shadcn accent blue). */
export function skillMenuContentClass(className?: string) {
  return cn(
    'z-[10000] min-w-[11rem] overflow-hidden rounded-md border border-border',
    'bg-bg-tertiary text-text-primary p-1',
    'shadow-[0_4px_16px_rgba(0,0,0,0.45)]',
    className,
  );
}

export function skillMenuItemClass(opts?: {
  danger?: boolean;
  className?: string;
}) {
  return cn(
    'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-md',
    'px-2.5 py-1.5 text-[12px] outline-none transition-colors',
    'text-text-primary',
    'focus:bg-bg-hover focus:text-text-primary',
    'data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
    '[&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:opacity-70',
    opts?.danger &&
      'text-accent-red focus:bg-accent-red/10 focus:text-accent-red data-[highlighted]:bg-accent-red/10 data-[highlighted]:text-accent-red',
    opts?.className,
  );
}

export function skillMenuLabelClass(className?: string) {
  return cn(
    'px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted',
    className,
  );
}

export function skillMenuSeparatorClass(className?: string) {
  return cn('my-1 h-px bg-border', className);
}
