import { InfoCircleIcon, ErrorOctagonIcon } from "./icons";

interface AppToastProps {
  toast: { message: string; type: "info" | "error" } | null;
}

export function AppToast({ toast }: AppToastProps) {
  if (!toast) return null;
  return (
    <div className={`app-toast app-toast--${toast.type}`}>
      {toast.type === "info" ? (
        <InfoCircleIcon size={14} />
      ) : (
        <ErrorOctagonIcon size={14} />
      )}
      <span>{toast.message}</span>
    </div>
  );
}
