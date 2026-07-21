import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useSkillStore, initialSkillState } from '../../store';
import SkillContent from '../SkillContent';

// stub 子视图，专注测试 SkillContent 路由逻辑
vi.mock('../LocalSkillContent', () => ({
  default: () => <div data-testid="local-skill-content">LocalSkillContent</div>,
}));
vi.mock('../MarketplaceContent', () => ({
  default: () => <div data-testid="marketplace-content">MarketplaceContent</div>,
}));
vi.mock('../ProjectSkillContent', () => ({
  default: () => <div data-testid="project-skill-content">ProjectSkillContent</div>,
}));
vi.mock('../AgentSkillContent', () => ({
  default: () => <div data-testid="agent-skill-content">AgentSkillContent</div>,
}));
vi.mock('../CreateSkillDialog', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-dialog">CreateSkillDialog</div> : null,
}));
vi.mock('../EditSkillDialog', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="edit-dialog">EditSkillDialog</div> : null,
}));
vi.mock('../ViewSkillDialog', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="view-dialog">ViewSkillDialog</div> : null,
}));

beforeEach(() => {
  useSkillStore.setState(initialSkillState);
});

// ─── 视图路由 ─────────────────────────────────────────────────────────────────

describe('SkillContent — 视图路由', () => {
  it('activeSkillView="local" 时渲染 LocalSkillContent', () => {
    useSkillStore.setState({ activeSkillView: 'local' });
    render(<SkillContent />);
    expect(screen.getByTestId('local-skill-content')).toBeInTheDocument();
  });

  it('activeSkillView="marketplace" 时渲染 MarketplaceContent', () => {
    useSkillStore.setState({ activeSkillView: 'marketplace' });
    render(<SkillContent />);
    expect(screen.getByTestId('marketplace-content')).toBeInTheDocument();
  });

  it('activeSkillView="project" 时渲染 ProjectSkillContent', () => {
    useSkillStore.setState({ activeSkillView: 'project' });
    render(<SkillContent />);
    expect(screen.getByTestId('project-skill-content')).toBeInTheDocument();
  });

  it('activeSkillView="agents" 时渲染 AgentSkillContent', () => {
    useSkillStore.setState({ activeSkillView: 'agents' });
    render(<SkillContent />);
    expect(screen.getByTestId('agent-skill-content')).toBeInTheDocument();
  });
});

// ─── Dialogs 初始状态 ────────────────────────────────────────────────────────

describe('SkillContent — Dialogs', () => {
  it('初始时所有 dialog 均为关闭状态', () => {
    render(<SkillContent />);
    expect(screen.queryByTestId('create-dialog')).toBeNull();
    expect(screen.queryByTestId('edit-dialog')).toBeNull();
    expect(screen.queryByTestId('view-dialog')).toBeNull();
  });
});
