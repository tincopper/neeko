import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ToolInfo } from "../types";

export function useToolStatus() {
  const [tools, setTools] = useState<ToolInfo[]>([]);

  const refreshTools = useCallback(async () => {
    try {
      const result = await invoke<ToolInfo[]>("get_tool_status");
      setTools(result);
    } catch (e) {
      console.error("Failed to load tool status:", e);
    }
  }, []);

  return { tools, refreshTools };
}
