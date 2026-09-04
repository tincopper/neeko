import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { STATUS_BAR_ITEMS } from '../registry';
import { StatusBarCluster } from '../StatusBarCluster';

vi.mock('../LspStatusSection', () => ({
  LspStatusSection: () => <div data-testid="lsp-section">lsp chip</div>,
  serverName: (languageId: string, liveName?: string | null) => liveName ?? languageId,
}));

const lspState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock('@/shared/store/lspStore', () => ({
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
  });

  it('安装中优先：会话与 profile 同时存在也只渲染 install', () => {
    setLsp({
      installProgress: { language_id: 'rust', phase: 'installing', message: '' },
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

  it('仅 profile 时渲染 profile 标签', () => {
    setLsp({ profiles: { '/proj': profile } });
    render(<StatusBarCluster side="left" items={LSP_GROUP} />);
    expect(screen.getByText('rust-analyzer')).toBeInTheDocument();
    expect(screen.queryByTestId('lsp-section')).not.toBeInTheDocument();
  });

  it('三者皆无时组内无输出', () => {
    const { container } = render(<StatusBarCluster side="left" items={LSP_GROUP} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('done 态渲染 server 标签（非 installing 动画）', () => {
    setLsp({
      installProgress: { language_id: 'rust', phase: 'done', message: '' },
      sessions: { '/proj': { rust: rustSession } },
      profiles: { '/proj': profile },
    });

    render(<StatusBarCluster side="left" items={LSP_GROUP} />);
    expect(screen.getByText('rust-analyzer')).toBeInTheDocument();
    expect(screen.queryByTestId('lsp-section')).not.toBeInTheDocument();
  });
});
