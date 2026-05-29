import React from "react";
import type { AuthMethod } from "../../../types";
import { useEditorContext } from '@/features/editor/context';
import TerminalViewBase from "./TerminalViewBase";
import { useRemoteTerminalStrategy } from "../strategies";

export interface RemoteTerminalViewProps {
  entryId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  fontSize?: number;
  fontFamily?: string;
  onSessionReady?: (projectId: string) => void;
  selectedAgentId?: string | null;
  paneId?: string;
  cacheKeySuffix?: string;
}

export default React.memo(function RemoteTerminalView(
  props: RemoteTerminalViewProps,
) {
  const {
    entryId,
    projectId,
    projectPath,
    host,
    port,
    username,
    auth,
    fontSize,
    fontFamily,
    onSessionReady,
    paneId = "p1",
    cacheKeySuffix,
  } = props;

  const strategy = useRemoteTerminalStrategy({
    entryId,
    projectId,
    projectPath,
    host,
    port,
    username,
    auth,
    fontSize,
    fontFamily,
    onSessionReady,
    paneId,
    cacheKeySuffix,
  });

  const { activeTabId, tabs } = useEditorContext();
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const tabAgentId = activeTab?.agentId ?? null;

  return (
    <TerminalViewBase
      strategy={strategy}
      tabAgentId={tabAgentId}
      activeTabId={activeTabId}
    />
  );
});
