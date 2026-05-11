import React, { createContext, useContext } from "react";

export interface FileActionsContextValue {
  onFileSelect: (filePath: string) => void;
  onFileRefresh: () => void;
  onFileCloseTab: (tabId: string) => void;
  onFileActivateTab: (tabId: string) => void;
  onFileSave: (content: string) => Promise<boolean>;
  onFileContentChange: (tabId: string, content: string) => void;
  onLoadFileTree: (projectId: string, worktreePath?: string) => void;
}

const FileActionsContext = createContext<FileActionsContextValue | null>(null);

export function FileActionsProvider({
  value,
  children,
}: {
  value: FileActionsContextValue;
  children: React.ReactNode;
}) {
  return (
    <FileActionsContext.Provider value={value}>
      {children}
    </FileActionsContext.Provider>
  );
}

export function useFileActionsContext() {
  const ctx = useContext(FileActionsContext);
  if (!ctx) {
    throw new Error("useFileActionsContext must be used within FileActionsProvider");
  }
  return ctx;
}
