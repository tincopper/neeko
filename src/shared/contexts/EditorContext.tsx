import React, { createContext, useContext } from 'react';

import type { EditorGroupId, AgentConfig, TerminalTab } from '@/shared/types';

export interface EditorContextValue {
  tabs: TerminalTab[];
  /**
   * 前台 tab —— **pane 局部值**，由 `usePaneTabs` 从布局派生后经 `usePaneEditorContext`
   * 注入（`EditorGroupPane` 每个 pane 自己的组）。全局 context 不再携带它：曾经的
   * 全局 `editorStore.activeTabId` 是「当前视图空间」的激活位，却被用在「某 tabKey 空间」
   * 的语义里（粒度错位），分屏下必然错位，已删除（2026-10-15 单源化）。
   */
  activeTabId?: string | null;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: (targetGroup?: EditorGroupId | 'pinned') => void;
  agents: AgentConfig[];
  compactMode: boolean;
  showAgentBar: boolean;
  hiddenAgentIds: string[];
  onToggleHiddenAgent: (agentId: string) => void;
  onAgentClick: (agent: AgentConfig) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({
  value,
  children,
}: {
  value: EditorContextValue;
  children?: React.ReactNode;
}) {
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditorContext() {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditorContext must be used within EditorProvider');
  }
  return ctx;
}
