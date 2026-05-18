import React, { useState, useCallback, useEffect, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { lineNumbers, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, keymap } from "@codemirror/view";
import { history, historyKeymap, indentWithTab, defaultKeymap } from "@codemirror/commands";
import { foldGutter, indentOnInput, bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { Eye, Save, FileCode, Globe } from "lucide-react";
import { getLanguageExtension, createCmTheme, isMarkdownFile } from "../../utils/codemirror";
import { MarkdownPreview } from "../ui";
import type { FileTab, AppTheme, Tab, FileTabData, FileContent } from "../../types";
import { useAppContext, useFileActionsContext } from "../../contexts";
import { useEditorContext } from "../../contexts/editor-context";
import { useAppStore } from "../../store/appStore";
import { buildWorktreeTabKey } from "../../utils/tabKey";
import { openHtmlInBrowserPanel, resolveAbsolutePath } from "../../utils/browserUtils";
import { useActiveProject } from "../../hooks/useActiveProject";
import InlineHtmlPreview from "./InlineHtmlPreview";
import { invoke } from "@tauri-apps/api/core";

type PreviewMode = "preview" | "source";

/** 检查文件是否为 HTML 文件 */
function isHtmlFile(filePath: string): boolean {
   const ext = filePath.split(".").pop()?.toLowerCase();
   return ext === "html" || ext === "htm";
}

/** Type guard: narrow Tab to file kind */
function isFileTab(tab: Tab): tab is Tab & { data: FileTabData } {
   return tab.data.kind === "file";
}

/** Convert a unified Tab (file kind) to legacy FileTab for FileEditor */
function tabToFileTab(tab: Tab & { data: FileTabData }): FileTab {
   return {
      id: tab.id,
      projectId: tab.projectId,
      filePath: tab.data.filePath,
      fileName: tab.data.fileName,
      content: tab.data.content,
      isDirty: tab.data.isDirty,
      order: tab.order,
   };
}

function FileViewer() {
   const { config } = useAppContext();
   const activeProjectId = useAppStore((state) => state.activeProjectId);
   const activeProject = useAppStore((state) => state.activeProject);
   const activeWslProject = useAppStore((state) => state.activeWslProject);
   const activeRemoteProject = useAppStore((state) => state.activeRemoteProject);
   const activeWorktreePath = useAppStore((state) => state.activeWorktreePath);
   const activeWslWorktreePath = useAppStore((state) => state.activeWslWorktreePath);
   const activeRemoteWorktreePath = useAppStore((state) => state.activeRemoteWorktreePath);
   const {
      onFileSave: onSave,
      onFileContentChange: onContentChange,
   } = useFileActionsContext();

   const theme = config.theme;
   const fontFamily = config.fontFamily;
   const fontSize = config.editorFontSize;

   // Composite tab key: unified across local/WSL/remote projects
   const currentProjectId = activeProjectId
      ?? activeWslProject?.project.id
      ?? activeRemoteProject?.project.id
      ?? null;
   const effectiveWorktreePath = activeWorktreePath
      ?? activeWslWorktreePath
      ?? activeRemoteWorktreePath
      ?? null;
   const tabKey = effectiveWorktreePath && currentProjectId
      ? buildWorktreeTabKey(currentProjectId, effectiveWorktreePath)
      : currentProjectId;

   // Read project tabs from unified store
   const projectTabs = useAppStore((state) => {
      if (!tabKey) return null;
      return state.tabs[tabKey] ?? null;
   });

   // Read per-group activeTabId from EditorContext (correct in split mode)
   const { activeTabId: groupActiveTabId } = useEditorContext();

   // Derive the active file tab from unified Tab.data (FileTabData)
   const activeFileTabInfo = useMemo(() => {
      if (!projectTabs) return null;
      // Prefer the group's active tab if it's a file tab
      let target = projectTabs.tabs.find((t) => t.id === groupActiveTabId);
      if (!target || !isFileTab(target)) {
         // Fall back to first file tab
         target = projectTabs.tabs.find(isFileTab);
      }
      if (!target || !isFileTab(target)) return null;
      return {
         fileTab: tabToFileTab(target),
         tabId: target.id,
         externallyModified: target.data.externallyModified ?? false,
      };
   }, [projectTabs, groupActiveTabId]);

   if (!activeFileTabInfo) {
      return (
         <div className="flex flex-col h-full items-center justify-center text-text-secondary">
            <FileCode size={48} className="mb-3 opacity-30" />
            <p>No file open</p>
            <p className="text-xs mt-1 opacity-60">Select a file from the tree to start editing</p>
         </div>
      );
   }

   const { fileTab: activeFileTab, tabId: activeTabId, externallyModified } = activeFileTabInfo;

   const projectPath = activeProject?.path
      ?? activeWslProject?.project.path
      ?? activeRemoteProject?.project.path
      ?? null;

   return (
      <div className="flex flex-col h-full">
         <FileEditor
            key={activeFileTab.id}
            tab={activeFileTab}
            tabKey={tabKey ?? ""}
            tabId={activeTabId}
            externallyModified={externallyModified}
            theme={theme}
            fontFamily={fontFamily}
            fontSize={fontSize}
            projectPath={projectPath}
            onSave={onSave}
            onContentChange={onContentChange}
         />
      </div>
   );
}

// Internal editor component for a single file tab
interface FileEditorProps {
   tab: FileTab;
   tabKey: string;
   tabId: string;
   externallyModified: boolean;
   theme: AppTheme;
   fontFamily: string;
   fontSize: number;
   projectPath: string | null;
   onSave: (content: string) => Promise<boolean>;
   onContentChange: (tabId: string, content: string) => void;
}

function FileEditor({ tab, tabKey, tabId, externallyModified, theme, fontFamily, fontSize, projectPath, onSave, onContentChange }: FileEditorProps) {
   const [previewMode, setPreviewMode] = useState<PreviewMode>("preview");
   const [isSaving, setIsSaving] = useState(false);
   const [langExtension, setLangExtension] = useState<import("@codemirror/state").Extension | null>(null);

   // 处理外部文件修改：重新加载
   const handleReload = useCallback(async () => {
      try {
         const content = await invoke<FileContent>("read_file_content", {
            projectId: tab.projectId,
            filePath: tab.filePath,
            rootPath: undefined,
         });
         useAppStore.getState().updateTab(tabKey, tabId, {
            kind: "file",
            content,
            isDirty: false,
            externallyModified: false,
         });
      } catch (e) {
         console.error("[FileEditor] Failed to reload file:", e);
      }
   }, [tab.projectId, tab.filePath, tabKey, tabId]);

   // 处理外部文件修改：保留当前编辑
   const handleKeepEdits = useCallback(() => {
      useAppStore.getState().updateTab(tabKey, tabId, {
         kind: "file",
         externallyModified: false,
      });
   }, [tabKey, tabId]);

   const isMd = isMarkdownFile(tab.filePath);
   const isHtml = isHtmlFile(tab.filePath);
   const currentContent = tab.content.content;

   const basePath = useMemo(() => {
      if (!projectPath) return undefined;
      // resolveAbsolutePath handles both relative and absolute filePaths correctly,
      // avoiding the double-root bug (e.g. "E:/ws/C:/project") when filePath is absolute.
      const absFilePath = resolveAbsolutePath(projectPath, tab.filePath);
      const lastSlash = absFilePath.lastIndexOf("/");
      return lastSlash >= 0 ? absFilePath.substring(0, lastSlash) : projectPath.replace(/\\/g, "/");
   }, [projectPath, tab.filePath]);

   // Load language extension lazily
   useEffect(() => {
      let cancelled = false;
      getLanguageExtension(tab.filePath).then((ext) => {
         if (!cancelled) setLangExtension(ext);
      });
      return () => {
         cancelled = true;
      };
   }, [tab.filePath]);

   const handleEditorChange = useCallback((value: string) => {
      onContentChange(tab.id, value);
   }, [tab.id, onContentChange]);

   const handleSave = useCallback(async () => {
      setIsSaving(true);
      await onSave(currentContent);
      setIsSaving(false);
   }, [currentContent, onSave]);

   // 获取项目类型信息（用于判断是否显示 Open in Browser）
   const { project } = useActiveProject();
   const isLocalProject = project?.type === "local";

   // 在 Browser Panel 中打开 HTML 文件
   const handleOpenInBrowser = useCallback(() => {
      if (!projectPath || !isLocalProject) return;
      openHtmlInBrowserPanel(resolveAbsolutePath(projectPath, tab.filePath));
   }, [tab.filePath, projectPath, isLocalProject]);

   // Ctrl+S handler
   const saveKeymap = useMemo(() => keymap.of([{
      key: "Ctrl-s",
      run: () => {
         if (tab.isDirty) {
            handleSave();
            return true;
         }
         return false;
      },
      preventDefault: true,
   }]), [tab.isDirty, handleSave]);

   // Create theme object (new reference triggers CodeMirror reconfigure)
   const cmTheme = useMemo(() => createCmTheme(fontFamily, fontSize), [fontFamily, fontSize, theme]);

   // Build CodeMirror extensions
   const extensions = useMemo(() => {
      const exts: import("@codemirror/state").Extension[] = [
         lineNumbers(),
         highlightActiveLineGutter(),
         highlightSpecialChars(),
         history(),
         foldGutter(),
         drawSelection(),
         dropCursor(),
         indentOnInput(),
         bracketMatching(),
         closeBrackets(),
         autocompletion(),
         highlightActiveLine(),
         keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
         ]),
         saveKeymap,
         cmTheme,
      ];

      if (langExtension) exts.push(langExtension);

      return exts;
   }, [langExtension, fontFamily, fontSize, saveKeymap, theme]);

   // Breadcrumb path segments
   const pathSegments = tab.filePath.replace(/\\/g, "/").split("/");

   // Determine if file can be edited
   const canEdit = !tab.content.is_binary && tab.content.size <= 512 * 1024;

   // Binary file
   if (tab.content.is_binary) {
      return (
         <div className="flex-1 flex flex-col">
            <EditorHeader
               pathSegments={pathSegments}
               isDirty={false}
               canEdit={false}
               isMd={false}
               isHtml={false}
               previewMode="preview"
               isSaving={false}
               onSave={() => { }}
               onTogglePreview={() => { }}
            />
            <div className="flex-1 flex items-center justify-center">
               <div className="text-center text-text-secondary">
                  <FileCode size={48} className="mx-auto mb-3 opacity-30" />
                   <p>Binary file — cannot be displayed</p>
                  <p className="text-xs mt-1 opacity-60">{formatFileSize(tab.content.size)}</p>
               </div>
            </div>
         </div>
      );
   }

   // Large file (view only)
   if (tab.content.size > 512 * 1024) {
      return (
         <div className="flex-1 flex flex-col">
            <EditorHeader
               pathSegments={pathSegments}
               isDirty={false}
               canEdit={false}
               isMd={false}
               isHtml={false}
               previewMode="preview"
               isSaving={false}
               onSave={() => { }}
               onTogglePreview={() => { }}
            />
            <div className="flex-1 flex items-center justify-center">
               <div className="text-center text-text-secondary">
                  <FileCode size={48} className="mx-auto mb-3 opacity-30" />
                   <p>File too large to edit (&gt; 500 KB)</p>
                  <p className="text-xs mt-1 opacity-60">{formatFileSize(tab.content.size)}</p>
               </div>
            </div>
         </div>
      );
   }

   // Markdown / HTML preview mode
   const showPreview = (isMd || isHtml) && previewMode === "preview";

   return (
      <div className="flex-1 flex flex-col min-h-0">
         {/* 外部文件修改 Modal */}
         {externallyModified && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
               <div className="bg-bg-primary border border-border rounded-lg shadow-xl p-6 w-[420px] max-w-[90vw]">
                  <h3 className="text-sm font-semibold text-text-primary mb-2">文件已在外部修改</h3>
                  <p className="text-sm text-text-secondary mb-1">
                     <span className="font-medium text-text-primary">{tab.fileName}</span> 已被外部程序修改。
                  </p>
                  <p className="text-sm text-text-secondary mb-5">
                     是否重新加载？你当前的编辑将会丢失。
                  </p>
                  <div className="flex justify-end gap-2">
                     <button
                        className="px-3 py-1.5 text-sm rounded border border-border text-text-secondary hover:bg-bg-hover transition-colors"
                        onClick={handleKeepEdits}
                     >
                        保留当前编辑
                     </button>
                     <button
                        className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:bg-accent/90 transition-colors"
                        onClick={handleReload}
                     >
                        重新加载
                     </button>
                  </div>
               </div>
            </div>
         )}

         <EditorHeader
            pathSegments={pathSegments}
            isDirty={tab.isDirty}
            canEdit={canEdit}
            isMd={isMd}
            isHtml={isHtml}
            previewMode={previewMode}
            isSaving={isSaving}
            onSave={handleSave}
            onTogglePreview={() => setPreviewMode((m) => (m === "preview" ? "source" : "preview"))}
            onOpenInBrowser={handleOpenInBrowser}
            isLocalProject={isLocalProject}
         />

         <div className="flex-1 min-h-0 overflow-hidden">
            {showPreview ? (
               isMd ? (
                  <div className="h-full overflow-y-auto px-6 py-4">
                     <MarkdownPreview
                        content={currentContent}
                        theme={theme}
                        basePath={basePath}
                     />
                  </div>
               ) : (
                  <InlineHtmlPreview
                     content={currentContent}
                     basePath={basePath}
                     fileName={tab.fileName}
                  />
               )
            ) : (
               <CodeMirror
                  value={currentContent}
                  height="100%"
                  extensions={extensions}
                  onChange={handleEditorChange}
                  editable={true}
                  readOnly={!canEdit}
                  theme={cmTheme}
                  basicSetup={false}
                  className="h-full overflow-auto"
               />
            )}
         </div>
      </div>
   );
}

// Header component for editor
interface EditorHeaderProps {
   pathSegments: string[];
   isDirty: boolean;
   canEdit: boolean;
   isMd: boolean;
   isHtml: boolean;
   previewMode: PreviewMode;
   isSaving: boolean;
   onSave: () => void;
   onTogglePreview: () => void;
   onOpenInBrowser?: () => void;
   isLocalProject?: boolean;
}

function EditorHeader({
   pathSegments,
   isDirty,
   canEdit,
   isMd,
   isHtml,
   previewMode,
   isSaving,
   onSave,
   onTogglePreview,
   onOpenInBrowser,
   isLocalProject,
}: EditorHeaderProps) {
   return (
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary/50">
         {/* Breadcrumb */}
         <div className="flex-1 flex items-center gap-1 text-xs text-text-secondary min-w-0 overflow-hidden">
            {pathSegments.map((seg, i) => (
               <React.Fragment key={i}>
                  {i > 0 && <span className="opacity-40">/</span>}
                  <span className={i === pathSegments.length - 1 ? "text-text-primary font-medium truncate" : "truncate"}>
                     {seg}
                  </span>
               </React.Fragment>
            ))}
            {isDirty && <span className="ml-1 text-accent">●</span>}
         </div>

         {/* Actions */}
         <div className="flex items-center gap-1 shrink-0">
            {/* Markdown / HTML preview toggle */}
            {(isMd || isHtml) && (
               <button
                  className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
                  onClick={onTogglePreview}
                  title={previewMode === "preview" ? "Switch to source" : "Switch to preview"}
               >
                  {previewMode === "preview" ? (
                     <span className="flex items-center gap-1"><FileCode size={12} /> Source</span>
                  ) : (
                     <span className="flex items-center gap-1"><Eye size={12} /> Preview</span>
                  )}
               </button>
            )}

            {/* HTML: Open in Browser Panel */}
            {isHtml && isLocalProject && (
               <button
                  className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
                  onClick={onOpenInBrowser}
                  title="Open in Browser Panel"
               >
                  <Globe size={12} /> Browser
               </button>
            )}

            {canEdit && (
               <button
                  className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1 disabled:opacity-50"
                  onClick={onSave}
                  disabled={!isDirty || isSaving}
                  title="Save (Ctrl+S)"
               >
                  <Save size={12} /> {isSaving ? "Saving..." : "Save"}
               </button>
            )}
         </div>
      </div>
   );
}

function formatFileSize(bytes: number): string {
   if (bytes < 1024) return `${bytes} B`;
   if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
   return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default React.memo(FileViewer);
