import React, { useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, keymap } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { history, historyKeymap, indentWithTab, defaultKeymap } from "@codemirror/commands";
import { foldGutter, indentOnInput, bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { Eye, Save, FileCode, Globe } from "@/shared/components/icons"
import { getLanguageExtension, createCmTheme, isMarkdownFile } from "../../../utils/codemirror";
import { MarkdownPreview } from "@/ui";
import type { FileTab, AppTheme, Tab, FileTabData, FileContent } from "../../../types";
import { useAppContext } from "../../../contexts";
import { useFileActionsContext } from "../file-actions-context";
import { useEditorContext } from "../context";
import { useProjectStore } from "../../../store/projectStore";
import { useConnectionStore } from "../../../store/connectionStore";
import { useWorktreeStore } from "../../../store/worktreeStore";
import { useEditorStore } from "../store";
import { useShallow } from "zustand/shallow";
import { buildWorktreeTabKey } from "../../../utils/tabKey";
import { openHtmlInBrowserPanel, resolveAbsolutePath } from "../../../utils/browserUtils";
import { useActiveProject } from "../../../hooks/useActiveProject";
import {
   getViewSnapshot,
   setViewSnapshot,
   clearViewSnapshot,
   type SerializedSelection,
} from "../../../utils/editorViewState";
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
   const activeProjectId = useProjectStore((state) => state.activeProjectId);
   const activeProject = useProjectStore((state) => state.activeProject);
   const activeWslProject = useConnectionStore((state) => state.activeWslProject);
   const activeRemoteProject = useConnectionStore((state) => state.activeRemoteProject);
   const activeWorktreePath = useWorktreeStore((state) => state.activeWorktreePath);
   const activeWslWorktreePath = useWorktreeStore((state) => state.activeWslWorktreePath);
   const activeRemoteWorktreePath = useWorktreeStore((state) => state.activeRemoteWorktreePath);
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
   const projectTabs = useEditorStore(useShallow((state) => {
      if (!tabKey) return null;
      return state.tabs[tabKey] ?? null;
   }));

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

   // CodeMirror EditorView 引用 + 是否已恢复过位置
   const editorViewRef = useRef<EditorView | null>(null);
   const editorRestoredRef = useRef(false);

   // 处理外部文件修改：重新加载
   const handleReload = useCallback(async () => {
      try {
         const projectPath = useProjectStore.getState().projects.find(p => p.id === tab.projectId)?.path ?? tab.projectId;
         const content = await invoke<FileContent>("read_file_content", {
            transport: { Local: { project_path: projectPath } },
            filePath: tab.filePath,
         });
         useEditorStore.getState().updateTab(tabKey, tabId, {
            kind: "file",
            content,
            isDirty: false,
            externallyModified: false,
         });
         // 文件内容已变，旧 selection 偏移可能越界，清掉以免恢复到错误位置
         clearViewSnapshot(tabKey, tabId, "editor");
         editorRestoredRef.current = false;
      } catch (e) {
         console.error("[FileEditor] Failed to reload file:", e);
      }
   }, [tab.projectId, tab.filePath, tabKey, tabId]);

   // 处理外部文件修改：保留当前编辑
   const handleKeepEdits = useCallback(() => {
      useEditorStore.getState().updateTab(tabKey, tabId, {
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

   // 获取 capabilities（用于判断是否显示 Open in Browser）
   const { capabilities } = useActiveProject();
   const canOpenInBrowser = (capabilities?.canEditFiles ?? false);

   // 在 Browser Panel 中打开 HTML 文件
   const handleOpenInBrowser = useCallback(() => {
      if (!projectPath || !canOpenInBrowser) return;
      openHtmlInBrowserPanel(resolveAbsolutePath(projectPath, tab.filePath));
   }, [tab.filePath, projectPath, canOpenInBrowser]);

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

   // 把当前 EditorView 状态写回缓存
   const saveEditorSnapshot = useCallback(() => {
      const view = editorViewRef.current;
      if (!view) return;
      try {
         const selJson = view.state.selection.toJSON() as SerializedSelection;
         setViewSnapshot(tabKey, tabId, "editor", {
            scrollTop: view.scrollDOM.scrollTop,
            selection: selJson,
         });
      } catch {
         // toJSON 极少失败；失败时仅落 scrollTop
         setViewSnapshot(tabKey, tabId, "editor", {
            scrollTop: view.scrollDOM.scrollTop,
         });
      }
   }, [tabKey, tabId]);

   // updateListener: selection / scroll / geometry 变化都更新一次缓存
   const viewStateExt = useMemo(
      () =>
         EditorView.updateListener.of((u) => {
            if (
               u.selectionSet ||
               u.geometryChanged ||
               u.viewportChanged ||
               u.docChanged
            ) {
               saveEditorSnapshot();
            }
         }),
      [saveEditorSnapshot],
   );

   // CodeMirror 初始化完成后：捕获 view 引用，恢复上次的 scrollTop/selection
   const handleCreateEditor = useCallback(
      (view: EditorView) => {
         editorViewRef.current = view;
         if (editorRestoredRef.current) return;

         const snap = getViewSnapshot(tabKey, tabId, "editor");
         if (!snap) {
            editorRestoredRef.current = true;
            return;
         }

         // 等下一帧让 CodeMirror 完成首屏 measure 再 scroll，避免被覆盖
         requestAnimationFrame(() => {
            try {
               if (snap.selection) {
                  const docLen = view.state.doc.length;
                  const safe = snap.selection.ranges.every(
                     (r) => r.anchor <= docLen && r.head <= docLen,
                  );
                  if (safe) {
                     view.dispatch({
                        selection: EditorSelection.fromJSON(snap.selection),
                        scrollIntoView: false,
                     });
                  }
               }
               const maxScroll = Math.max(
                  0,
                  view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight,
               );
               view.scrollDOM.scrollTop = Math.min(snap.scrollTop, maxScroll);
            } catch (e) {
               console.warn("[FileEditor] restore editor view failed", e);
            } finally {
               editorRestoredRef.current = true;
            }
         });
      },
      [tabKey, tabId],
   );

   // 卸载兜底：再保存一次（updateListener 大多已覆盖，但保险起见）
   useEffect(() => {
      return () => {
         saveEditorSnapshot();
         editorViewRef.current = null;
         editorRestoredRef.current = false;
      };
   }, [saveEditorSnapshot]);

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
         viewStateExt,
      ];

      if (langExtension) exts.push(langExtension);

      return exts;
   }, [langExtension, fontFamily, fontSize, saveKeymap, theme, viewStateExt]);

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
            canOpenInBrowser={canOpenInBrowser}
         />

         <div className="flex-1 min-h-0 overflow-hidden">
            {showPreview ? (
               isMd ? (
                  <MarkdownScrollContainer tabKey={tabKey} tabId={tabId} content={currentContent}>
                     <MarkdownPreview
                        content={currentContent}
                        theme={theme}
                        basePath={basePath}
                     />
                  </MarkdownScrollContainer>
               ) : (
                  <InlineHtmlPreview
                     tabKey={tabKey}
                     tabId={tabId}
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
                  onCreateEditor={handleCreateEditor}
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
    canOpenInBrowser?: boolean;
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
    canOpenInBrowser,
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
            {isHtml && canOpenInBrowser && (
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

/**
 * Markdown preview 滚动容器：在 tab 切换时保存/恢复 scrollTop。
 * 内容变化（content 改动）时，保留 scrollTop 但 clamp 到新的最大可滚动值。
 */
interface MarkdownScrollContainerProps {
   tabKey: string;
   tabId: string;
   content: string;
   children: React.ReactNode;
}

function MarkdownScrollContainer({ tabKey, tabId, content, children }: MarkdownScrollContainerProps) {
   const ref = useRef<HTMLDivElement | null>(null);

   // 挂载 + 内容变化后恢复 scrollTop（用 layoutEffect 抢在浏览器绘制前）
   useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return;
      const snap = getViewSnapshot(tabKey, tabId, "markdown");
      if (!snap) return;
      // 内容渲染可能尚未完成（图片/mermaid 异步）；先尝试一次，再 rAF 兜底
      const apply = () => {
         const max = Math.max(0, el.scrollHeight - el.clientHeight);
         el.scrollTop = Math.min(snap.scrollTop, max);
      };
      apply();
      const raf = requestAnimationFrame(apply);
      return () => cancelAnimationFrame(raf);
   }, [tabKey, tabId, content]);

   const handleScroll = useCallback(() => {
      const el = ref.current;
      if (!el) return;
      setViewSnapshot(tabKey, tabId, "markdown", { scrollTop: el.scrollTop });
   }, [tabKey, tabId]);

   useEffect(() => {
      return () => {
         const el = ref.current;
         if (!el) return;
         setViewSnapshot(tabKey, tabId, "markdown", { scrollTop: el.scrollTop });
      };
   }, [tabKey, tabId]);

   return (
      <div ref={ref} onScroll={handleScroll} className="h-full overflow-y-auto px-6 py-4">
         {children}
      </div>
   );
}

export default React.memo(FileViewer);
