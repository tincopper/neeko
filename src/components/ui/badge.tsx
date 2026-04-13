import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
  {
    variants: {
      variant: {
        added:    "bg-accent-green/20 text-accent-green",
        modified: "bg-accent-yellow/20 text-accent-yellow",
        deleted:  "bg-accent-red/20 text-accent-red",
        default:  "bg-bg-tertiary text-text-secondary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
