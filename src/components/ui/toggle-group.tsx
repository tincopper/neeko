import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "../../utils/cn";

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    data-slot="toggle-group"
    className={cn(
      "inline-flex bg-bg-tertiary border border-border rounded-md overflow-hidden",
      className
    )}
    {...props}
  />
));
ToggleGroup.displayName = "ToggleGroup";

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    data-slot="toggle-group-item"
    className={cn(
      "py-1 px-3.5 bg-none border-none text-text-secondary text-[0.86em] cursor-pointer transition-[background-color,color] duration-150",
      "hover:bg-bg-hover hover:text-text-primary",
      "border-r border-border last:border-r-0",
      "data-[state=on]:bg-accent-blue data-[state=on]:text-white",
      "focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1",
      className
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = "ToggleGroupItem";

export { ToggleGroup, ToggleGroupItem };
