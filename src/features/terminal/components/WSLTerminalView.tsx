import React from "react";
import { useEditorContext } from '@/app/editor/context';
import TerminalViewBase from "./TerminalViewBase";
import { useWslTerminalStrategy } from "../strategies";

interface WSLTerminalViewProps {
  paneId?: string;
}

export default React.memo(function WSLTerminalView({
  paneId = "p1",
}: WSLTerminalViewProps) {
  const strategy = useWslTerminalStrategy(paneId);
  const { activeTabId, tabs } = useEditorContext();
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const tabAgentId = activeTab?.agentId ?? null;

  if (!strategy) return null;

  return (
    <TerminalViewBase
      strategy={strategy}
      tabAgentId={tabAgentId}
      activeTabId={activeTabId}
    />
  );
});
