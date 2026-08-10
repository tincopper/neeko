import { render, screen, fireEvent, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as searchApi from '@/features/search/api/searchApi';
import { AppProvider } from '@/shared/contexts';

import { SearchPanel } from '../SearchPanel';

vi.mock('@/features/search/api/searchApi', async () => {
  const actual = await vi.importActual<typeof searchApi>('@/features/search/api/searchApi');
  return {
    ...actual,
    runSearch: vi.fn(),
    stopSearch: vi.fn(),
  };
});

const runMock = vi.mocked(searchApi.runSearch);
const stopMock = vi.mocked(searchApi.stopSearch);

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <AppProvider
      value={{
        config: {} as any,
        customThemes: [],
        agents: [],
        agentInstalledMap: {},
        loading: false,
        ideCommandOverrides: {},
        showToast: vi.fn(),
        saveConfig: vi.fn(),
      }}
    >
      {ui}
    </AppProvider>,
  );
}

function mockPage() {
  return {
    requestId: 'req-1',
    query: 'foo',
    projectId: 'p-1',
    matches: [
      {
        path: 'src/a.rs',
        matches: [{ path: 'src/a.rs', line: 3, column: 1, lineText: 'fn foo() {}' }],
      },
    ],
    // truncated=true so hasMore=false: in jsdom the list height is always
    // smaller than the viewport; without truncation auto-load would fire forever.
    cursor: { offset: 10, totalPages: -1 },
    truncated: true,
  };
}

async function settle(ms = 350) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe('SearchPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runMock.mockResolvedValue(mockPage());
    stopMock.mockResolvedValue(undefined);
  });

  it('渲染输入框与空态提示', () => {
    renderWithProvider(<SearchPanel projectId="p-1" />);
    expect(screen.getByLabelText('Search project files')).toBeInTheDocument();
    expect(screen.getByText('Type to search across project files.')).toBeInTheDocument();
  });

  it('输入后（防抖）展示匹配结果', async () => {
    renderWithProvider(<SearchPanel projectId="p-1" />);

    fireEvent.change(screen.getByLabelText('Search project files'), { target: { value: 'foo' } });
    await settle();
    expect(runMock).toHaveBeenCalledTimes(1);
    // File name is shown in the file header
    await expect(screen.findByText('a.rs')).resolves.toBeInTheDocument();
  });

  it('空 query 不触发搜索', async () => {
    renderWithProvider(<SearchPanel projectId="p-1" />);
    fireEvent.change(screen.getByLabelText('Search project files'), { target: { value: '   ' } });
    await settle();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('清除按钮清空输入', async () => {
    renderWithProvider(<SearchPanel projectId="p-1" />);

    fireEvent.change(screen.getByLabelText('Search project files'), { target: { value: 'foo' } });
    await settle();
    await screen.findByText('a.rs');

    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.getByLabelText('Search project files')).toHaveValue('');
  });

  it('搜索失败时通过 toast 显示错误', async () => {
    runMock.mockRejectedValue(new Error('backend exploded'));
    renderWithProvider(<SearchPanel projectId="p-1" />);

    fireEvent.change(screen.getByLabelText('Search project files'), { target: { value: 'foo' } });
    await settle();
    // Error is shown via toast, not inline
    expect(screen.queryByText('backend exploded')).not.toBeInTheDocument();
  });

  it('展示文件匹配数 badge', async () => {
    renderWithProvider(<SearchPanel projectId="p-1" />);

    fireEvent.change(screen.getByLabelText('Search project files'), { target: { value: 'foo' } });
    await settle();

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('展示结果总数在输入区域', async () => {
    renderWithProvider(<SearchPanel projectId="p-1" />);

    fireEvent.change(screen.getByLabelText('Search project files'), { target: { value: 'foo' } });
    await settle();

    expect(screen.getByText('1 result')).toBeInTheDocument();
  });

  it('展示状态栏', async () => {
    renderWithProvider(<SearchPanel projectId="p-1" />);

    fireEvent.change(screen.getByLabelText('Search project files'), { target: { value: 'foo' } });
    await settle();

    expect(screen.getByText('1 content')).toBeInTheDocument();
    expect(screen.getByText('1 matches total')).toBeInTheDocument();
  });
});
