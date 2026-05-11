import React, { useState, useCallback, useEffect, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { lineNumbers, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, keymap } from "@codemirror/view";
import { history, historyKeymap, indentWithTab, defaultKeymap } from "@codemirror/commands";
import { foldGutter, indentOnInput, bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { Eye, Save, FileCode, Globe } from "lucide-react";
import { getLanguageExtension, createCmTheme, isMarkdownFile } from "../../utils/codemirror";
import { MarkdownPreview } from "../ui";
import type { FileTab, AppTheme, Tab, FileTabData } from "../../types";
import { useAppContext, useFileActionsContext } from "../../contexts";
import { useAppStore } from "../../store/appStore";

type MarkdownMode = "preview" | "source";

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
   const {
      onFileSave: onSave,
      onFileContentChange: onContentChange,
   } = useFileActionsContext();

   const theme = config.theme;
   const fontFamily = config.fontFamily;
   const fontSize = config.editorFontSize;

   // Read project tabs from unified store
   const projectTabs = useAppStore((state) => {
      if (!activeProjectId) return null;
      return state.tabs[activeProjectId] ?? null;
   });

   // Derive the active file tab from unified Tab.data (FileTabData)
   const activeFileTab = useMemo(() => {
      if (!projectTabs) return null;
      // Prefer the project's active tab if it's a file tab
      let target = projectTabs.tabs.find((t) => t.id === projectTabs.activeTabId);
      if (!target || !isFileTab(target)) {
         // Fall back to first file tab
         target = projectTabs.tabs.find(isFileTab);
      }
      if (!target || !isFileTab(target)) return null;
      return tabToFileTab(target);
   }, [projectTabs]);

   if (!activeFileTab) {
      return (
         <div className="flex flex-col h-full items-center justify-center text-text-secondary">
            <FileCode size={48} className="mb-3 opacity-30" />
            <p>No file open</p>
            <p className="text-xs mt-1 opacity-60">Select a file from the tree to start editing</p>
         </div>
      );
   }

   return (
      <div className="flex flex-col h-full">
         <FileEditor
            key={activeFileTab.id}
            tab={activeFileTab}
            theme={theme}
            fontFamily={fontFamily}
            fontSize={fontSize}
            onSave={onSave}
            onContentChange={onContentChange}
         />
      </div>
   );
}

// Internal editor component for a single file tab
interface FileEditorProps {
   tab: FileTab;
   theme: AppTheme;
   fontFamily: string;
   fontSize: number;
   onSave: (content: string) => Promise<boolean>;
   onContentChange: (tabId: string, content: string) => void;
}

function FileEditor({ tab, theme, fontFamily, fontSize, onSave, onContentChange }: FileEditorProps) {
   const [markdownMode, setMarkdownMode] = useState<MarkdownMode>("preview");
   const [isSaving, setIsSaving] = useState(false);
   const [langExtension, setLangExtension] = useState<import("@codemirror/state").Extension | null>(null);

   const isMd = isMarkdownFile(tab.filePath);
   const isHtml = isHtmlFile(tab.filePath);
   const currentContent = tab.content.content;

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

   // 打开 HTML 预览 Tab
   const handleOpenHtmlPreview = useCallback(() => {
      const activeProjectId = useAppStore.getState().activeProjectId;
      if (!activeProjectId) return;

      // 使用固定的 Tab ID 进行去重
      const previewTabId = `${activeProjectId}:preview:${tab.filePath}`;

      // 检查是否已存在该预览 Tab
      const existingTabs = useAppStore.getState().tabs[activeProjectId];
      const existingPreview = existingTabs?.tabs.find((t) => t.id === previewTabId);

      if (existingPreview) {
         // 如果已存在，直接激活
         useAppStore.getState().activateTab(activeProjectId, previewTabId);
         return;
      }

      // 创建新的 html-preview Tab
      const previewTab: Tab = {
         id: previewTabId,
         projectId: activeProjectId,
         title: `Preview: ${tab.fileName}`,
         order: existingTabs?.tabs.length ?? 0,
         data: {
            kind: "html-preview",
            filePath: tab.filePath,
            fileName: tab.fileName,
         },
      };

      useAppStore.getState().addTab(activeProjectId, previewTab);
   }, [tab.filePath, tab.fileName]);

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
               markdownMode="preview"
               isSaving={false}
               onSave={() => { }}
               onToggleMarkdown={() => { }}
               onOpenHtmlPreview={() => { }}
            />
            <div className="flex-1 flex items-center justify-center">
               <div className="text-center text-text-secondary">
                  <FileCode size={48} className="mx-auto mb-3 opacity-30" />
                  <p>二进制文件 — 无法显示</p>
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
               markdownMode="preview"
               isSaving={false}
               onSave={() => { }}
               onToggleMarkdown={() => { }}
               onOpenHtmlPreview={() => { }}
            />
            <div className="flex-1 flex items-center justify-center">
               <div className="text-center text-text-secondary">
                  <FileCode size={48} className="mx-auto mb-3 opacity-30" />
                  <p>文件过大，无法编辑（&gt; 500 KB）</p>
                  <p className="text-xs mt-1 opacity-60">{formatFileSize(tab.content.size)}</p>
               </div>
            </div>
         </div>
      );
   }

   // Markdown preview mode
   const showPreview = isMd && markdownMode === "preview";

   return (
      <div className="flex-1 flex flex-col min-h-0">
         <EditorHeader
            pathSegments={pathSegments}
            isDirty={tab.isDirty}
            canEdit={canEdit}
            isMd={isMd}
            isHtml={isHtml}
            markdownMode={markdownMode}
            isSaving={isSaving}
            onSave={handleSave}
            onToggleMarkdown={() => setMarkdownMode((m) => (m === "preview" ? "source" : "preview"))}
            onOpenHtmlPreview={handleOpenHtmlPreview}
         />

         <div className="flex-1 min-h-0 overflow-hidden">
            {showPreview ? (
               <div className="h-full overflow-y-auto px-6 py-4">
                  <MarkdownPreview content={currentContent} theme={theme} />
               </div>
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
   markdownMode: MarkdownMode;
   isSaving: boolean;
   onSave: () => void;
   onToggleMarkdown: () => void;
   onOpenHtmlPreview: () => void;
}

function EditorHeader({
   pathSegments,
   isDirty,
   canEdit,
   isMd,
   isHtml,
   markdownMode,
   isSaving,
   onSave,
   onToggleMarkdown,
   onOpenHtmlPreview,
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
            {/* Markdown toggle */}
            {isMd && (
               <button
                  className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
                  onClick={onToggleMarkdown}
                  title={markdownMode === "preview" ? "Switch to source" : "Switch to preview"}
               >
                  {markdownMode === "preview" ? (
                     <span className="flex items-center gap-1"><FileCode size={12} /> Source</span>
                  ) : (
                     <span className="flex items-center gap-1"><Eye size={12} /> Preview</span>
                  )}
               </button>
            )}

            {/* HTML Preview button */}
            {isHtml && (
               <button
                  className="px-2 py-1 text-[var(--font-size)] rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
                  onClick={onOpenHtmlPreview}
                  title="Open HTML preview"
               >
                  <Globe size={12} /> Preview
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
