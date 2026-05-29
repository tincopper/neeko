import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from '@/lib/utils';

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200",
        "bg-bg-tertiary",
        "focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1",
        "data-[state=checked]:bg-accent-blue",
        "data-[state=unchecked]:bg-bg-tertiary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200",
          "data-[state=checked]:translate-x-4",
          "data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
