import { fireEvent, render as renderRTL, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 生产接线级验收（Block-1 的护栏）。
 *
 * 背景：「当前激活文件」的唯一权威是 tab 空间（`editorLayout` → `tabs`），
 * 派生点是 `useLocateFileInTree`。历史上 `FilesPanelWrapper` 从
 * `useFileStore.activeFilePath` 取值 —— 那个字段**从未有任何写入者**（恒为 null），
 * 于是 chevron 之外的视觉反馈全部失效：
 *   · 头部激活文件路径永远不显示
 *   · `buildFileTreeView` 的 `is_active` 盖章永不命中 → accent 高亮失效
 *   · `useDirExpansion` 的激活文件联动永不触发
 *
 * 既有面板级测试都**直接注入 `activeFilePath` prop**，绕过了这条断链，所以全绿也
 * 掩盖了缺陷（判据与消费点不同语义）。本文件因此**不 mock FilesPanel**，走真实
 * Wrapper + 真实 store + 真实 tab 空间，确保接线本身被测到。
 */

const { invokeSpy } = vi.hoisted(() => ({ invokeSpy: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeSpy,
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

vi.mock('@/features/file/hooks/useFileDrop', () => ({
  setDragFile: vi.fn(),
  useFileDrop: vi.fn(),
}));

import { FilesPanelWrapper } from '@/app/dock/wrappers/FilesPanelWrapper';
import { FileActionsProvider } from '@/features/editor/FileActionsContext';
import { useFileStore } from '@/features/file/store';
import { panelView } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { DirTreeResult, Project, Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';
import { createDirNode as dirNode, createFileNode as fileNode } from '@/testing/factories';

const ROOT_PATH = '/demo';
const PROJECT: Project = {
  id: 'p1',
  name: 'demo',
  path: ROOT_PATH,
  environment: { type: 'Local' },
} as unknown as Project;

const TAB_KEY = WorkspaceSession.of('p1', null).key;

/** 根预扫深度内的目录树：src/deep 存在但未预扫内容 */
const ROOT: DirTreeResult = {
  nodes: [dirNode('src', 'src', [dirNode('deep', 'src/deep')])],
  truncated: false,
};
const SRC: DirTreeResult = {
  nodes: [dirNode('deep', 'src/deep')],
  truncated: false,
};
const DEEP: DirTreeResult = {
  nodes: [fileNode('a.ts', 'src/deep/a.ts')],
  truncated: false,
};

const DEEP_FILE_ABS = `${ROOT_PATH}/src/deep/a.ts`;

/** 一个真实的 file tab（scope 必须是 workspace，文件 tab 恒为 canonical 绝对路径） */
function makeFileTab(): Tab {
  const workspace = WorkspaceSession.of('p1', null);
  return {
    id: `${TAB_KEY}:${DEEP_FILE_ABS}`,
    scope: { kind: 'workspace', session: workspace },
    title: 'a.ts',
    data: {
      kind: 'file',
      filePath: DEEP_FILE_ABS,
      fileName: 'a.ts',
      content: {
        content: 'export const a = 1;',
        language: 'typescript',
        is_binary: false,
      } as never,
      isDirty: false,
    },
  } as Tab;
}

/**
 * 定位树上某个文件行。
 *
 * 用可访问名（treeitem 的 accessible name = 内部文本）而非 querySelector ——
 * 既避开头部同名文本，也符合 `testing-library/no-node-access`。
 */
function findRow(name: string): HTMLElement {
  const rows = screen.getAllByRole('treeitem');
  const row = rows.find((r) => r.textContent?.replace(/\s+/g, ' ').trim() === name);
  if (!row) throw new Error(`tree row not found: ${name} (rows: ${rows.length})`);
  return row;
}

/** 行内文件名标签（accent 色盖章点） */
function rowLabel(row: HTMLElement): HTMLElement {
  return within(row).getByText(/./);
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** 生产接线：Wrapper 依赖 FileActionsContext（dock 面板在 App 中就这么挂载） */
function renderWrapper() {
  const value = {
    onFileSelect: vi.fn().mockResolvedValue(true),
    onFileCloseTab: vi.fn(),
    onFileActivateTab: vi.fn(),
    onFileSave: vi.fn().mockResolvedValue(true),
    onFileSaveTab: vi.fn().mockResolvedValue(true),
    onFileContentChange: vi.fn(),
  };
  return renderRTL(
    createElement(FileActionsProvider, { value }, createElement(FilesPanelWrapper)),
    {
      wrapper: createAppProviderWrapper(),
    },
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(1200);

  invokeSpy.mockReset();
  invokeSpy.mockImplementation((cmd: string, args?: { subPath?: string | null }) => {
    if (cmd === 'read_dir_tree') {
      const sub = args?.subPath ?? null;
      if (sub === null) return Promise.resolve(ROOT);
      if (sub === 'src') return Promise.resolve(SRC);
      if (sub === 'src/deep') return Promise.resolve(DEEP);
      return Promise.resolve({ nodes: [], truncated: false } as DirTreeResult);
    }
    return Promise.resolve(null);
  });

  useFileStore.getState().reset();
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useProjectStore.setState({ activeProject: PROJECT, activeProjectId: 'p1' as never, entries: {} });
  useWorkspaceStore.setState({ byProject: {} });
  // 面板可见性门控 = isViewVisible（槽前台 + 展开）：把 files 拎到左槽前台
  // （FilesPanelWrapper 本身不关心视图在哪个槽，只要「可见」）
  useDockStore.getState().moveView(panelView('files'), 'left', 0);
  useDockStore.getState().activateView(panelView('files'));
  useDockStore.getState().setSlotExpanded('left', true);
});

describe('FilesPanel 生产接线：激活文件来自 tab 空间（Block-1 护栏）', () => {
  it('打开 file tab 后：目标行获得 is_active 高亮（不再读恒为 null 的 store 字段）', async () => {
    renderWrapper();

    // 首屏根目录加载
    expect(await screen.findByText('src')).toBeInTheDocument();

    // 用户在编辑器里打开 src/deep/a.ts（唯一权威 = tab 空间）
    useEditorStore.getState().addTab(makeFileTab());

    // tab 变化驱动:祖先链展开 + 加载 + 高亮
    await waitFor(
      () => {
        expect(screen.getByText('a.ts')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    const row = findRow('a.ts');
    // aria-selected 反映高亮态（可访问性契约）
    expect(row).toHaveAttribute('aria-selected', 'true');
    // is_active 盖章命中 → 行携带 data-active（**稳定契约**）
    expect(row).toHaveAttribute('data-active', 'true');
    // 名字色与激活态无关：高亮行一徥回中性前景色（详 gitFileDecoration 的
    // statusToNameColorClass 注释 —— 曾经此处是 text-accent，而那是 12% 透明底色）
    expect(rowLabel(row)).toHaveClass('text-text-primary');
  });

  it('打开 file tab 后：头部显示激活文件路径（activeFileName 不再恒为空）', async () => {
    renderWrapper();
    expect(await screen.findByText('src')).toBeInTheDocument();

    useEditorStore.getState().addTab(makeFileTab());

    await waitFor(() => {
      // 头部路径区展示激活文件（旧实现在此处回落到项目路径）
      expect(screen.getByText('src/deep/a.ts')).toBeInTheDocument();
    });
  });

  it('深于预扫深度的祖先目录被真正加载（联动与加载同源，无需再点一次）', async () => {
    renderWrapper();
    expect(await screen.findByText('src')).toBeInTheDocument();

    useEditorStore.getState().addTab(makeFileTab());

    // src/deep 从未预扫 → 必须由联动触发 loadDir（只改展开态会得到「展开但空白」）
    await waitFor(
      () => {
        expect(useFileStore.getState().loadStates['src/deep']).toBe('loaded');
      },
      { timeout: 3000 },
    );
    expect(useFileStore.getState().expandedDirs.has('src/deep')).toBe(true);
  });

  it('切走 tab（无 file tab）后：data-active 退场（aria-selected 还含选中态，不作判据）', async () => {
    renderWrapper();
    expect(await screen.findByText('src')).toBeInTheDocument();

    const tab = makeFileTab();
    useEditorStore.getState().addTab(tab);
    await waitFor(() => expect(findRow('a.ts')).toHaveAttribute('data-active', 'true'));

    // 关闭该 tab → 无 file tab → locateTargetPath 为 null
    useEditorStore.getState().closeTab(TAB_KEY, tab.id);

    await waitFor(() => {
      const rows = screen.queryAllByRole('treeitem');
      const row = rows.find((r) => r.textContent?.replace(/\s+/g, ' ').trim() === 'a.ts');
      if (!row) return; // 行可能因祖先折叠而不渲染
      // aria-selected = isActive || isSelected，选择态可能仍为 true；
      // 名字色在高亮行恒为中性色（不随激活变）。所以只看激活态本身的契约：
      // data-active 退场 = is_active 真的关掉了 —— 那才是本次接线的作用面。
      expect(row).not.toHaveAttribute('data-active');
    });
  });
});

describe('FilesPanel 生产接线：目录交互仍正常（确保接线改造无回归）', () => {
  it('点击目录行展开后能看到子项（基础交互）', async () => {
    renderWrapper();
    expect(await screen.findByText('src')).toBeInTheDocument();

    fireEvent.click(screen.getByText('src'));

    await waitFor(() => {
      const list = within(screen.getByTestId('scroll-list'));
      expect(list.getByText('deep')).toBeInTheDocument();
    });
  });
});
