import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cn } from '@/lib/utils';

function Checkbox({
  className,
  label,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  label?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 cursor-pointer select-none",
        "text-sm text-text-secondary",
        className
      )}
    >
      <CheckboxPrimitive.Root
        data-slot="checkbox"
        className={cn(
          "w-[15px] h-[15px] rounded border-[1.5px] border-border bg-bg-tertiary",
          "flex items-center justify-center shrink-0",
          "outline-none transition-colors duration-150",
          "hover:border-accent-blue",
          "focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1",
          "data-[state=checked]:bg-accent-blue data-[state=checked]:border-accent-blue",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator>
          <svg width="9" height="5" viewBox="0 0 9 5" fill="none" className="text-white">
            <path d="M1 2.5L3 4.5L8 0.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && <span>{label}</span>}
    </label>
  );
}

export { Checkbox };
