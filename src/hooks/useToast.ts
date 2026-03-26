import { useState, useRef } from "react";

export function useToast() {
  const [toast, setToast] = useState<{
    message: string;
    type: "info" | "error";
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: "info" | "error" = "info") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  return { toast, showToast };
}
