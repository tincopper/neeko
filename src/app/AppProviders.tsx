import type { ComponentProps, ReactNode } from 'react';

import { dockPanelRegistry } from '@/app/dock/registry';
import { FileActionsProvider } from '@/features/editor/FileActionsContext';
import { ConnectionProjectProvider } from '@/features/project';
import { ProjectActionsProvider } from '@/features/project/ProjectContext';
import { DockRegistryProvider } from '@/layout';
import { AppProvider, EditorProvider, TerminalInsertProvider } from '@/shared/contexts';

import ComposeProviders from './utils/ComposeProviders';

type AppProviderValue = ComponentProps<typeof AppProvider>['value'];
type ProjectActionsProviderValue = ComponentProps<typeof ProjectActionsProvider>['value'];
type FileActionsProviderValue = ComponentProps<typeof FileActionsProvider>['value'];
type ConnectionProjectProviderValue = ComponentProps<typeof ConnectionProjectProvider>['value'];
type EditorProviderValue = ComponentProps<typeof EditorProvider>['value'];

interface AppProvidersProps {
  appValue: AppProviderValue;
  projectActionsValue: ProjectActionsProviderValue;
  fileActionsValue: FileActionsProviderValue;
  connectionProjectValue: ConnectionProjectProviderValue;
  editorValue: EditorProviderValue;
  children: ReactNode;
}

function AppProviders({
  appValue,
  projectActionsValue,
  fileActionsValue,
  connectionProjectValue,
  editorValue,
  children,
}: AppProvidersProps) {
  return (
    <ComposeProviders
      providers={[
        // 顺序即嵌套（从外到内）。已核实：当前无 Provider 自身消费其他 Context
        // （useAppContext 消费方全在 children 子树），无硬性顺序约束；
        // AppProvider 置于最外是「最基础 Context 最外」惯例 —— 若将来某 Provider
        // 内部消费 useAppContext，必须保持在其内层。
        <AppProvider key="app" value={appValue} />,
        <ProjectActionsProvider key="project-actions" value={projectActionsValue} />,
        <FileActionsProvider key="file-actions" value={fileActionsValue} />,
        <ConnectionProjectProvider key="connection-project" value={connectionProjectValue} />,
        <EditorProvider key="editor" value={editorValue} />,
        // 纯装配型 Provider（无依赖，逻辑平级）：终端/agent 输入能力 + dock 面板 registry
        <TerminalInsertProvider key="terminal-insert" />,
        <DockRegistryProvider key="dock-registry" registry={dockPanelRegistry} />,
      ]}
    >
      {children}
    </ComposeProviders>
  );
}

export default AppProviders;
