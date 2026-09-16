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
import { useEffect } from 'react';

import { useCmdHeld } from '@/features/lsp';
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

  const { lspLanguageIdRef, lspClientExt, linkHighlightExt } = useLspClient({
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

  return { lspClientExt, lspKeymap, cmdClickExt, linkHighlightExt, cmClassName };
}
