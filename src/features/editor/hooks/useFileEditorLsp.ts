/**
 * 编辑器 LSP 装配簇：client（扩展 + 语言 id）、导航（定义跳转 / 引用）、jdt 链接 hover 跳转，
 * 以及交互态光标样式（Cmd 按住 = 可点链接、跳转进行中 = loading）。
 *
 * 为什么单独成 hook：这三者之间有**两段式晚绑定**（`onOpenJdtLink` 先交给 client，
 * `navigateToLocation` 就绪后再 bind），装配顺序与解绑时机属于同一件事；把它与文件挂载、
 * 断点、运行入口混在 `FileEditor` 里，会让「改 LSP 装配」与「改编辑器挂载」互相干扰。
 *
 * 依赖方向：本 hook 只依赖 editor 域的 LSP 装配 hook 与 lsp 域公开面，不反向依赖组件。
 */
import type { EditorView } from '@codemirror/view';
import { useEffect, useMemo } from 'react';

import { fromFileUri, getLspLanguageId, lspQuickFix, useCmdHeld } from '@/features/lsp';
import { useLspStore } from '@/features/lsp/store/lspStore';
import { cn } from '@/lib/utils';
import type { FileTab } from '@/shared/types';
import { tabLspDocumentUri } from '@/shared/utils/jdt';

import { useJdtLinkNavigation } from './useJdtLinkNavigation';
import { useLspClient } from './useLspClient';
import { useLspNavigation } from './useLspNavigation';

interface UseFileEditorLspParams {
  tab: FileTab;
  tabKey: string;
  projectPath: string | null;
  editorViewRef: React.MutableRefObject<EditorView | null>;
}

export function useFileEditorLsp({
  tab,
  tabKey,
  projectPath,
  editorViewRef,
}: UseFileEditorLspParams) {
  // hover 的 jdt:// 链接 → 跳转：回调引用恒定（可先交给 useLspClient），
  // navigateToLocation 就绪后再 bind（两段式晚绑定，见 useJdtLinkNavigation）。
  const { onOpenJdtLink, bind: bindJdtLinkNav } = useJdtLinkNavigation();

  const { fileUri, lspLanguageIdRef, lspClientExt, linkHighlightExt } = useLspClient({
    projectPath,
    filePath: tab.filePath,
    virtualUri: tab.virtualUri ?? tabLspDocumentUri(tab),
    onOpenJdtLink,
  });

  const { lspKeymap, cmdClickExt, navigateToLocation } = useLspNavigation({
    projectPath,
    tabKey,
    tab,
    lspLanguageIdRef,
    editorViewRef,
  });

  // effect 返回解绑：ref 不超出 tab 存活期（回调归属由 LSP 侧 facet 保证）。
  useEffect(
    () =>
      bindJdtLinkNav(navigateToLocation, {
        projectPath,
        tabKey,
        projectId: tab.projectId,
        filePath: tab.filePath,
      }),
    [bindJdtLinkNav, navigateToLocation, projectPath, tabKey, tab.projectId, tab.filePath],
  );

  // Cmd/Ctrl 按住 → 链接高亮光标；显式跳转进行中 → loading 光标（冷启动 server 握手时给出可感知反馈）
  const cmdHeld = useCmdHeld();
  const isJumping = useLspStore((state) => state.isDefinitionJumping);
  const cmClassName = cn(
    'h-full overflow-hidden',
    cmdHeld && 'cmd-held',
    isJumping && 'lsp-jumping',
  );

  // 编辑器内 quickfix：uri 直接取 **`useLspClient` 算出的 `fileUri`**（就是 didOpen 用的那个）。
  // 不要自己再算一遍：曾误用 `tabLspDocumentUri`（它只对 jdt:// 虚拟文档返回 uri，普通文件
  // 恒为 undefined），导致扩展拿到 uri=null、三条入口全部静默 return。
  // 语言 ID 由 uri 纯推导（与 Problems 面板的诊断行同一算法），不读 ref ——
  // 渲染期把 ref 传进函数会违反 react-hooks/refs，且这里本就不需要"会话握手后"的时效性：
  // 拿不到语言 ID 时扩展的各入口会安静返回，等 uri 就绪后 memo 会重算。
  const quickFixExt = useMemo(
    () =>
      lspQuickFix({
        projectPath,
        uri: fileUri || null,
        getLanguageId: () => (fileUri ? getLspLanguageId(fromFileUri(fileUri)) : null),
      }),
    [projectPath, fileUri],
  );

  return { lspClientExt, lspKeymap, quickFixExt, cmdClickExt, linkHighlightExt, cmClassName };
}
