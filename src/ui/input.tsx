import * as React from "react";
import { cn } from '@/lib/utils';

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "w-full px-3 py-2.5 bg-bg-primary border border-border rounded-md",
        "text-text-primary text-[var(--font-size)] font-mono",
        "outline-none transition-colors duration-200",
        "focus:border-accent-blue focus:ring-2 focus:ring-accent-blue",
        "placeholder:text-text-muted",
        // Hide number spinners
        "[&[type=number]]:[-moz-appearance:textfield]",
        "[&[type=number]]:[&::-webkit-inner-spin-button]:appearance-none",
        "[&[type=number]]:[&::-webkit-outer-spin-button]:appearance-none",
        className
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full px-3 py-2.5 bg-bg-primary border border-border rounded-md",
        "text-text-primary text-[var(--font-size)] font-mono",
        "outline-none transition-colors duration-200",
        "focus:border-accent-blue focus:ring-2 focus:ring-accent-blue",
        "placeholder:text-text-muted",
        "resize-y min-h-[80px]",
        className
      )}
      {...props}
    />
  );
}

export { Input, Textarea };
