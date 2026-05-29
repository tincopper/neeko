import React, { useCallback } from "react";
import { useAppContext, useEditorContext } from "../../../contexts";
import { useEditorStore } from "../../../store/editorStore";
import TerminalViewBase from "./TerminalViewBase";
import { useLocalTerminalStrategy } from "../strategies";
import type { TerminalViewProps } from "./terminalTypes";

function TerminalView({ paneId, worktreePath, worktreeBranch }: TerminalViewProps) {
  const { config } = useAppContext();
  const { activeTabId, tabs, onTabStatusChange } = useEditorContext();
  const strategy = useLocalTerminalStrategy(paneId, worktreePath, worktreeBranch);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const tabAgentId = activeTab?.agentId ?? null;

  const agentCommandOverride = config.agentCommandOverrides?.[tabAgentId ?? ""];

  // Task terminal fields — read from full Tab data in editorStore
  const projectId = strategy ? strategy.cacheKey.split(":")[0] : null;
  const fullTabData = useEditorStore((s) => {
    if (!projectId || !activeTabId) return null;
    const pt = s.tabs[projectId];
    return pt?.tabs.find((t) => t.id === activeTabId)?.data ?? null;
  });
  const taskCommand = fullTabData?.kind === "terminal" ? (fullTabData.taskCommand ?? null) : null;
  const taskConfigId = fullTabData?.kind === "terminal" ? (fullTabData.taskConfigId ?? null) : null;
  const taskRebuildKey = fullTabData?.kind === "terminal" ? (fullTabData.rebuildKey ?? 0) : 0;

  const handleStatusChange = useCallback(
    (status: "Idle" | "Running" | "Failed") => {
      if (activeTabId) {
        onTabStatusChange?.(activeTabId, status);
      }
    },
    [activeTabId, onTabStatusChange],
  );

  if (!strategy) return null;

  return (
    <TerminalViewBase
      strategy={strategy}
      tabAgentId={tabAgentId}
      activeTabId={activeTabId}
      taskCommand={taskCommand}
      taskConfigId={taskConfigId}
      taskRebuildKey={taskRebuildKey}
      agentCommandOverride={agentCommandOverride}
      onStatusChange={handleStatusChange}
    />
  );
}

export default React.memo(TerminalView);
