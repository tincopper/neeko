import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetLibraryState, useLibraryStore } from '@/features/library/store/libraryStore';
import type { TerminalInsertApi } from '@/shared/contexts';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Project } from '@/shared/types';
import type { PromptResource } from '@/shared/types/library';
import type { Tab } from '@/shared/types/tab';
const hoisted = vi.hoisted(() => ({
  toast: vi.fn(),
  api: { current: {} as TerminalInsertApi },
}));

vi.mock('@/shared/contexts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/contexts')>();
  return {
    ...actual,
    useTerminalInsert: () => ({ api: hoisted.api.current, register: vi.fn(() => () => {}) }),
    useAppContext: () => ({ showToast: hoisted.toast }),
  };
});

vi.mock('@/features/library/api/libraryApi', () => ({
  listPrompts: vi.fn().mockResolvedValue([]),
  deletePrompt: vi.fn().mockResolvedValue(undefined),
  recordPromptUsage: vi.fn().mockResolvedValue(undefined),
}));

import { PromptsStatusSection } from '../PromptsStatusSection';

function projectFixture(): Project {
  return {
    id: 'proj-1',
    name: 'demo',
    path: '/tmp/demo',
    environment: { type: 'Local' },
    git_info: null,
    terminal: { id: 't1', pid: null, status: 'Idle', history: [], agent: null },
    selected_agents: [],
    selected_ide: null,
    active_view: 'Terminal',
    collapsed: false,
  };
}

function promptFixture(over: Partial<PromptResource> & { id: string }): PromptResource {
  return {
    name: `prompt-${over.id}`,
    description: null,
    content: `content-${over.id}`,
    slash: null,
    tags: [],
    scope: 'global',
    favorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: 1,
    updatedAt: 2,
    ...over,
  };
}

const REVIEW = promptFixture({
  id: 'p1',
  name: 'Review',
  description: 'Review code changes',
  content: 'review this diff',
  slash: 'review',
  tags: ['code'],
  favorite: true,
  usageCount: 5,
  lastUsedAt: 200,
});

const PLAIN = promptFixture({
  id: 'p2',
  name: 'Plain notes',
  description: null,
  content: 'line1\nline2 content here',
  tags: [],
  favorite: false,
  usageCount: 0,
  lastUsedAt: 300,
});

const WITH_VAR = promptFixture({
  id: 'p3',
  name: 'Var prompt',
  description: 'has variable',
  content: 'hi {{name}}',
  tags: [],
  favorite: false,
  usageCount: 0,
  lastUsedAt: 100,
});
function terminalTabFixture(id: string): Tab {
  return {
    id,
    projectId: 'proj-1',
    title: 'Terminal',
    order: 0,
    data: { kind: 'terminal', agentId: null, status: 'Idle' },
  };
}

function fileTabFixture(id: string): Tab {
  return {
    id,
    projectId: 'proj-1',
    title: 'a.ts',
    order: 1,
    data: {
      kind: 'file',
      filePath: 'src/a.ts',
      fileName: 'a.ts',
      content: { path: 'src/a.ts', content: 'x', size: 1, is_binary: false },
      isDirty: false,
    },
  };
}

function setEditorTabs(tabs: Tab[], activeTabId: string | null) {
  useEditorStore.setState({ tabs: { 'proj-1': { tabs, activeTabId } } });
}

function setProject(present: boolean) {
  useProjectStore.setState(
    present
      ? { activeProject: projectFixture(), activeProjectId: 'proj-1' }
      : { activeProject: null, activeProjectId: null },
  );
}
describe('PromptsStatusSection', () => {
  beforeEach(() => {
    resetLibraryState();
    setProject(true);
    setEditorTabs([], null);
    useWorktreeStore.setState({ activeWorktreePath: null });
    hoisted.api.current = {};
    hoisted.toast.mockClear();
  });

  it('无项目时隐藏 chip', () => {
    setProject(false);
    useLibraryStore.setState({ prompts: [REVIEW] });
    render(<PromptsStatusSection />);
    expect(screen.queryByTestId('prompts-status-chip')).not.toBeInTheDocument();
  });

  it('有项目时渲染 chip，点击弹出带搜索的下拉', () => {
    useLibraryStore.setState({ prompts: [REVIEW, PLAIN] });
    render(<PromptsStatusSection />);
    expect(screen.getByTestId('prompts-status-chip')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    expect(screen.getByTestId('prompts-status-dropdown')).toBeInTheDocument();
    expect(screen.getByTestId('prompts-status-search')).toBeInTheDocument();
    expect(screen.getByTestId('prompts-status-row-p1')).toBeInTheDocument();
  });

  it('再次点击 chip 关闭下拉，Esc 与外部点击也关闭', () => {
    useLibraryStore.setState({ prompts: [REVIEW] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    expect(screen.getByTestId('prompts-status-dropdown')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    expect(screen.queryByTestId('prompts-status-dropdown')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('prompts-status-dropdown')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('prompts-status-dropdown')).not.toBeInTheDocument();
  });

  it('favorite 置顶：lastUsedAt 更小但 favorite 的行排在前面', () => {
    // PLAIN.lastUsedAt=300 > REVIEW.lastUsedAt=200，但 REVIEW favorite → REVIEW first
    useLibraryStore.setState({ prompts: [PLAIN, REVIEW] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    const rows = screen.getAllByTestId(/^prompts-status-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'prompts-status-row-p1',
      'prompts-status-row-p2',
    ]);
  });

  it('description 为空时回退 content 首 120 字并把换行转空格', () => {
    useLibraryStore.setState({ prompts: [PLAIN] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    const row = screen.getByTestId('prompts-status-row-p2');
    expect(within(row).getByText('line1 line2 content here')).toBeInTheDocument();
  });

  it('搜索按 name/slash/description/tags 过滤', () => {
    useLibraryStore.setState({ prompts: [REVIEW, PLAIN, WITH_VAR] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.change(screen.getByTestId('prompts-status-search'), { target: { value: 'review' } });
    expect(screen.getByTestId('prompts-status-row-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('prompts-status-row-p2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prompts-status-row-p3')).not.toBeInTheDocument();
  });

  it('空 prompts 显示空态引导', () => {
    useLibraryStore.setState({ prompts: [] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    expect(screen.getByTestId('prompts-status-empty')).toBeInTheDocument();
  });

  it('行点击：插入成功静默（无 toast）并关闭下拉', () => {
    const insertToTerminal = vi.fn(() => true);
    hoisted.api.current = { insertToTerminal };
    useLibraryStore.setState({ prompts: [REVIEW] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.click(screen.getByTestId('prompts-status-row-p1'));
    expect(insertToTerminal).toHaveBeenCalledWith('review this diff');
    expect(hoisted.toast).not.toHaveBeenCalled();
    expect(screen.queryByTestId('prompts-status-dropdown')).not.toBeInTheDocument();
  });

  it('行点击：无活动终端时 toast“无活动终端”，不静默丢失', () => {
    hoisted.api.current = { insertToTerminal: vi.fn(() => false) };
    useLibraryStore.setState({ prompts: [REVIEW] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.click(screen.getByTestId('prompts-status-row-p1'));
    expect(hoisted.toast).toHaveBeenCalledWith(expect.stringContaining('无活动终端'), 'info');
  });

  it('含 {{var}} 的行点击先弹变量框，确认前不插入', () => {
    const insertToTerminal = vi.fn(() => true);
    hoisted.api.current = { insertToTerminal };
    useLibraryStore.setState({ prompts: [WITH_VAR] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.click(screen.getByTestId('prompts-status-row-p3'));
    expect(useLibraryStore.getState().variableDialogOpen).toBe(true);
    expect(insertToTerminal).not.toHaveBeenCalled();
    expect(hoisted.toast).not.toHaveBeenCalled();
  });
  it('Enter 确认当前高亮首项：插入并关闭下拉、无 toast', () => {
    const insertToTerminal = vi.fn(() => true);
    hoisted.api.current = { insertToTerminal };
    useLibraryStore.setState({ prompts: [REVIEW, PLAIN, WITH_VAR] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.keyDown(screen.getByTestId('prompts-status-search'), { key: 'Enter' });
    // 默认高亮首项（favorite 置顶的 REVIEW）
    expect(insertToTerminal).toHaveBeenCalledWith('review this diff');
    expect(hoisted.toast).not.toHaveBeenCalled();
    expect(screen.queryByTestId('prompts-status-dropdown')).not.toBeInTheDocument();
  });

  it('空结果时 Enter 无操作：不插入、不 toast、不关闭', () => {
    const insertToTerminal = vi.fn(() => true);
    hoisted.api.current = { insertToTerminal };
    useLibraryStore.setState({ prompts: [REVIEW] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.change(screen.getByTestId('prompts-status-search'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('prompts-status-empty')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('prompts-status-search'), { key: 'Enter' });
    expect(insertToTerminal).not.toHaveBeenCalled();
    expect(hoisted.toast).not.toHaveBeenCalled();
    expect(screen.getByTestId('prompts-status-dropdown')).toBeInTheDocument();
  });

  it('ArrowDown/ArrowUp 在结果内移动高亮（到尾后回绕）', () => {
    hoisted.api.current = { insertToTerminal: vi.fn(() => true) };
    useLibraryStore.setState({ prompts: [REVIEW, PLAIN, WITH_VAR] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    const search = screen.getByTestId('prompts-status-search');
    // 排序：p1（favorite）→ p2（lastUsedAt 300）→ p3（lastUsedAt 100）
    expect(screen.getByTestId('prompts-status-row-p1')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByTestId('prompts-status-row-p2')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('prompts-status-row-p1')).toHaveAttribute('aria-selected', 'false');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByTestId('prompts-status-row-p3')).toHaveAttribute('aria-selected', 'true');
    // 到尾后回绕到首项（与 PromptInsertDialog 一致）
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByTestId('prompts-status-row-p1')).toHaveAttribute('aria-selected', 'true');
    // 首项 ArrowUp 回绕到末项
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(screen.getByTestId('prompts-status-row-p3')).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter 插入的是高亮项而非首项', () => {
    const insertToTerminal = vi.fn(() => true);
    hoisted.api.current = { insertToTerminal };
    useLibraryStore.setState({ prompts: [REVIEW, PLAIN, WITH_VAR] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    const search = screen.getByTestId('prompts-status-search');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(insertToTerminal).toHaveBeenCalledWith('line1\nline2 content here');
  });

  it('query 变化时高亮重置为首项', () => {
    hoisted.api.current = { insertToTerminal: vi.fn(() => true) };
    useLibraryStore.setState({ prompts: [REVIEW, PLAIN, WITH_VAR] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    const search = screen.getByTestId('prompts-status-search');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByTestId('prompts-status-row-p2')).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(search, { target: { value: 'review' } });
    expect(screen.getByTestId('prompts-status-row-p1')).toHaveAttribute('aria-selected', 'true');
  });

  it('重新打开时高亮重置为首项', () => {
    hoisted.api.current = { insertToTerminal: vi.fn(() => true) };
    useLibraryStore.setState({ prompts: [REVIEW, PLAIN] });
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.keyDown(screen.getByTestId('prompts-status-search'), { key: 'ArrowDown' });
    expect(screen.getByTestId('prompts-status-row-p2')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    expect(screen.queryByTestId('prompts-status-dropdown')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    expect(screen.getByTestId('prompts-status-row-p1')).toHaveAttribute('aria-selected', 'true');
  });

  it('插入成功后终端露面：激活本项目终端 tab，仍无 toast', () => {
    const insertToTerminal = vi.fn(() => true);
    hoisted.api.current = { insertToTerminal };
    useLibraryStore.setState({ prompts: [REVIEW] });
    const file = fileTabFixture('proj-1:src/a.ts');
    const term = terminalTabFixture('proj-1:term-1');
    setEditorTabs([file, term], file.id);
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.click(screen.getByTestId('prompts-status-row-p1'));
    expect(insertToTerminal).toHaveBeenCalledWith('review this diff');
    expect(useEditorStore.getState().tabs['proj-1']?.activeTabId).toBe(term.id);
    expect(hoisted.toast).not.toHaveBeenCalled();
  });

  it('插入失败时不切换 tab：toast“无活动终端”', () => {
    hoisted.api.current = { insertToTerminal: vi.fn(() => false) };
    useLibraryStore.setState({ prompts: [REVIEW] });
    const file = fileTabFixture('proj-1:src/a.ts');
    const term = terminalTabFixture('proj-1:term-1');
    setEditorTabs([file, term], file.id);
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.click(screen.getByTestId('prompts-status-row-p1'));
    expect(useEditorStore.getState().tabs['proj-1']?.activeTabId).toBe(file.id);
    expect(hoisted.toast).toHaveBeenCalledWith(expect.stringContaining('无活动终端'), 'info');
  });

  it('已在终端 tab 上时插入成功不切换', () => {
    const insertToTerminal = vi.fn(() => true);
    hoisted.api.current = { insertToTerminal };
    useLibraryStore.setState({ prompts: [REVIEW] });
    const term = terminalTabFixture('proj-1:term-1');
    setEditorTabs([term], term.id);
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.click(screen.getByTestId('prompts-status-row-p1'));
    expect(useEditorStore.getState().tabs['proj-1']?.activeTabId).toBe(term.id);
    expect(hoisted.toast).not.toHaveBeenCalled();
  });

  it('无终端 tab 时插入成功静默跳过露面、不崩溃', () => {
    const insertToTerminal = vi.fn(() => true);
    hoisted.api.current = { insertToTerminal };
    useLibraryStore.setState({ prompts: [REVIEW] });
    const file = fileTabFixture('proj-1:src/a.ts');
    setEditorTabs([file], file.id);
    render(<PromptsStatusSection />);
    fireEvent.click(screen.getByTestId('prompts-status-chip'));
    fireEvent.click(screen.getByTestId('prompts-status-row-p1'));
    expect(insertToTerminal).toHaveBeenCalledWith('review this diff');
    expect(useEditorStore.getState().tabs['proj-1']?.activeTabId).toBe(file.id);
    expect(hoisted.toast).not.toHaveBeenCalled();
  });
});
