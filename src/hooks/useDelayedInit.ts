import { useEffect } from "react";

export function useDelayedInit(deps: { loadAgents: () => Promise<void> }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      deps.loadAgents();
    }, 100);

    return () => clearTimeout(timer);
  }, [deps.loadAgents]);
}