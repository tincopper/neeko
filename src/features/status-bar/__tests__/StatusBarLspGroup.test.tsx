import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lspCheckServerInstalled } from '@/features/lsp/api/lspApi';

import { STATUS_BAR_ITEMS } from '../registry';
import { StatusBarCluster } from '../StatusBarCluster';

vi.mock('../LspStatusSection', () => ({
  LspStatusSection: () => <div data-testid="lsp-section">lsp chip</div>,
  serverName: (languageId: string, liveName?: string | null) => liveName ?? languageId,
}));
vi.mock('@/features/lsp/api/lspApi', () => ({
  lspCheckServerInstalled: vi.fn(),
}));

const lspState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock('@/features/lsp/store/lspStore', () => ({
  useLspStore: (sel: (s: Record<string, unknown>) => unknown) => sel(lspState.current),
}));

vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ activeProject: { id: 'p1', path: '/proj', name: 'demo' } }),
}));

const LSP_GROUP = STATUS_BAR_ITEMS.filter((d) => d.id === 'lsp');

const rustSession = {
  languageId: 'rust',
  serverName: 'rust-analyzer',
  status: 'ready',
};

const profile = {
  projectPath: '/proj',
  primary: { languageId: 'rust', serverName: 'rust-analyzer', markers: ['Cargo.toml'] },
  candidates: [{ languageId: 'rust', serverName: 'rust-analyzer' }],
};

function setLsp(partial: Record<string, unknown>) {
  lspState.current = {
    installProgress: null,
    sessions: {},
    profiles: {},
    extensionConflicts: [],
    ...partial,
  };
}

describe('statusBarLspGroup', () => {
  beforeEach(() => {
    setLsp({});
    vi.mocked(lspCheckServerInstalled).mockResolvedValue(true);
  });

  it('安装中优先：会话与 profile 同时存在也只渲染 install', () => {
    setLsp({
      installProgress: { language_id: 'rust', phase: 'installing', message: '', log: '' },
      sessions: { '/proj': { rust: rustSession } },
      profiles: { '/proj': profile },
    });
    const { container } = render(<StatusBarCluster side="left" items={LSP_GROUP} />);
    expect(screen.getByText(/Installing/)).toBeInTheDocument();
    expect(screen.queryByTestId('lsp-section')).not.toBeInTheDocument();
    expect(screen.queryByText('rust-analyzer')).not.toBeInTheDocument();
    expect(container).toBeInTheDocument();
  });

  it('有会话无安装时只渲染 lsp-section', () => {
    setLsp({
      sessions: { '/proj': { rust: rustSession } },
      profiles: { '/proj': profile },
    });
    render(<StatusBarCluster side="left" items={LSP_GROUP} />);
    expect(screen.getByTestId('lsp-section')).toBeInTheDocument();
    expect(screen.queryByText('rust-analyzer')).not.toBeInTheDocument();
  });

  it('仅 profile 时渲染 profile 标签，并标注已安装态', async () => {
    setLsp({ profiles: { '/proj': profile } });
    render(<StatusBarCluster side="left" items={LSP_GROUP} />);
    expect(screen.getByText('rust-analyzer')).toBeInTheDocument();
    // 安装态经异步软检后落定：await 提示文本
    await screen.findByTitle('rust-analyzer is installed — open a matching file to start it.');
    expect(screen.queryByTestId('lsp-section')).not.toBeInTheDocument();
  });

  it('仅 profile 且未安装时标注未安装态（红点 + 提示）', async () => {
    vi.mocked(lspCheckServerInstalled).mockResolvedValue(false);
    setLsp({ profiles: { '/proj': profile } });
    render(<StatusBarCluster side="left" items={LSP_GROUP} />);
    expect(screen.getByText('rust-analyzer')).toBeInTheDocument();
    await screen.findByTitle(
      'rust-analyzer is not installed — open a matching file to auto-install it.',
    );
  });

  it('三者皆无时组内无输出', () => {
    const { container } = render(<StatusBarCluster side="left" items={LSP_GROUP} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('安装中可展开查看实时日志', () => {
    setLsp({
      installProgress: {
        language_id: 'rust',
        phase: 'installing',
        message: 'Installing rust-analyzer: 下载 1.61.0',
        log: '[stage] 查询最新发行版\n[stage] 下载 1.61.0\n100% |##########|',
      },
    });
    const { container } = render(<StatusBarCluster side="left" items={LSP_GROUP} />);

    expect(screen.getByText(/Installing rust/)).toBeInTheDocument();
    // 日志默认折叠
    expect(screen.queryByTestId('lsp-install-log')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('日志'));
    const panel = screen.getByTestId('lsp-install-log');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('下载 1.61.0');
    expect(container).toBeInTheDocument();
  });

  it('done 态渲染 server 标签（非 installing 动画）', () => {
    setLsp({
      installProgress: { language_id: 'rust', phase: 'done', message: '', log: '' },
      sessions: { '/proj': { rust: rustSession } },
      profiles: { '/proj': profile },
    });

    render(<StatusBarCluster side="left" items={LSP_GROUP} />);
    expect(screen.getByText('rust-analyzer')).toBeInTheDocument();
    expect(screen.queryByTestId('lsp-section')).not.toBeInTheDocument();
  });
});
