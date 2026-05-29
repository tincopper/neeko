import { cn } from "../../utils/cn";
import { InfoCircleIcon, ErrorOctagonIcon } from "./icons";

interface AppToastProps {
  toast: { message: string; type: "info" | "error" } | null;
}

export function AppToast({ toast }: AppToastProps) {
  if (!toast) return null;
  return (
    <div className={cn(
      "app-toast",
      "fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2.5 rounded-lg text-sm font-medium shadow-lg z-[9999] pointer-events-none max-w-md",
      toast.type === "info" && "app-toast--info",
      toast.type === "error" && "app-toast--error",
    )}>
      {toast.type === "info" ? (
        <InfoCircleIcon size={14} />
      ) : (
        <ErrorOctagonIcon size={14} />
      )}
      <span>{toast.message}</span>
    </div>
  );
}
