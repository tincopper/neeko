/**
 * `useFileEditorLsp` 的 quickfix 契约。
 *
 * 为什么单独建文件：`getLanguageId`（`useFileEditorLsp.ts:88` 的内联回调）只在**执行代码动作**时
 * 才被调用，而组合冒烟测试（`FileEditor.compose.test.tsx`）刻意把 `lspQuickFix` stub 成空数组
 * （它只验证接线），于是这条路径在全量覆盖率里恒为未覆盖 —— 而 vitest.config 把该文件钉在 100%。
 * 这里补的就是那一处判据：uri 就绪 ⇒ 返回语言 id；uri 缺失 ⇒ 返回 null（扩展入口拿 null 会安静返回）。
 *
 * Mock 边界：只替换被装配的 hook 与外部功能，`useFileEditorLsp` 本体保持真实。
 */
import type { EditorView } from '@codemirror/view';
import { renderHook } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileTab } from '@/shared/types';

import { useFileEditorLsp } from '../useFileEditorLsp';

const mocks = vi.hoisted(() => ({
  lspQuickFix: vi.fn(),
  useLspClient: vi.fn(),
  useLspNavigation: vi.fn(),
  cmdHeld: false,
}));

vi.mock('@/features/lsp', () => ({
  useCmdHeld: () => mocks.cmdHeld,
  lspQuickFix: mocks.lspQuickFix,
  fromFileUri: (uri: string) => uri.replace('file://', ''),
  getLspLanguageId: (path: string) => (path.endsWith('.go') ? 'go' : null),
}));

vi.mock('../useLspClient', () => ({ useLspClient: mocks.useLspClient }));
vi.mock('../useLspNavigation', () => ({ useLspNavigation: mocks.useLspNavigation }));
vi.mock('../useJdtLinkNavigation', () => ({
  useJdtLinkNavigation: () => ({ onOpenJdtLink: vi.fn(), bind: () => vi.fn() }),
}));

const TAB = { filePath: '/repo/main.go', projectId: 'p1' } as unknown as FileTab;
const EDITOR_VIEW_REF = { current: null } as React.MutableRefObject<EditorView | null>;

function renderWith(fileUri: string | null) {
  mocks.useLspClient.mockReturnValue({
    fileUri,
    lspLanguageIdRef: { current: null },
    lspClientExt: ['client-ext'],
    linkHighlightExt: ['link-ext'],
  });
  return renderHook(() =>
    useFileEditorLsp({
      tab: TAB,
      tabKey: 'tab-1',
      projectPath: '/repo',
      editorViewRef: EDITOR_VIEW_REF,
    }),
  );
}

beforeEach(() => {
  mocks.lspQuickFix.mockReset().mockReturnValue(['quickfix-ext']);
  mocks.useLspNavigation.mockReset().mockReturnValue({
    lspKeymap: ['keymap'],
    cmdClickExt: ['cmd-ext'],
    navigateToLocation: vi.fn(),
  });
});

describe('useFileEditorLsp 的 quickfix 装配', () => {
  it('uri 就绪时，getLanguageId 由该 uri 推导出语言 id', () => {
    renderWith('file:///repo/main.go');

    const options = mocks.lspQuickFix.mock.calls[0][0];
    expect(options.uri).toBe('file:///repo/main.go');
    expect(options.getLanguageId()).toBe('go');
  });

  it('uri 未就绪时，getLanguageId 返回 null（三条入口安静返回）', () => {
    renderWith(null);

    const options = mocks.lspQuickFix.mock.calls[0][0];
    expect(options.uri).toBeNull();
    expect(options.getLanguageId()).toBeNull();
  });

  it('把装配结果原样透出（client / keymap / quickfix / 交互态样式）', () => {
    const { result } = renderWith('file:///repo/main.go');

    expect(result.current.lspClientExt).toEqual(['client-ext']);
    expect(result.current.linkHighlightExt).toEqual(['link-ext']);
    expect(result.current.lspKeymap).toEqual(['keymap']);
    expect(result.current.cmdClickExt).toEqual(['cmd-ext']);
    expect(result.current.quickFixExt).toEqual(['quickfix-ext']);
    expect(result.current.cmClassName).toBe('h-full overflow-hidden');
  });
});
