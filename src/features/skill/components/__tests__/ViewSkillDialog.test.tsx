import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AppProvider } from '@/shared/contexts';
import type { AppConfig } from '@/shared/types/settings';
import { expectNoGlobalSideEffectsOnMount } from '@/testing/mountInvariance';
import { invoke } from '@/testing/tauriCore';

import { createManagedSkill } from '../../../../testing/factories';
import { useSkillStore, initialSkillState } from '../../store';
import ViewSkillDialog from '../ViewSkillDialog';

// 真实组合根里该 dialog 恒在 AppProvider 内；测试必须同构，否则修成
// useAppContext() 后会在这里假绿（抛 "must be used within AppProvider"）。
const appValue = {
  config: { theme: 'light' } as AppConfig,
  customThemes: [],
  agents: [],
  agentInstalledMap: {},
  loading: false,
  ideCommandOverrides: {},
  showToast: vi.fn(),
  saveConfig: async () => {},
};
const render = (ui: ReactElement) => rtlRender(<AppProvider value={appValue}>{ui}</AppProvider>);

const mockInvoke = vi.mocked(invoke);

vi.mock('@/ui/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}));

vi.mock('@/features/browser/api/browserApi', () => ({
  openInDefaultBrowser: vi.fn(),
}));

vi.mock('@/features/file/api/fileApi', () => ({
  revealInFileManager: vi.fn(),
}));

beforeEach(() => {
  useSkillStore.setState(initialSkillState);
  document.documentElement.setAttribute('data-theme', 'light');
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'load_config') return {};
    if (cmd === 'get_skill_document') return { content: '# Skill Content' };
    return undefined;
  });
});

const localSkill = createManagedSkill({
  id: 'sk-1',
  name: 'View Skill',
  description: 'A great skill',
  tags: ['react', 'frontend'],
  source_type: 'local',
  source_ref: '/Users/user/original/skill-dir',
});

const gitSkill = createManagedSkill({
  id: 'sk-2',
  name: 'Git Skill',
  description: 'A git skill',
  tags: ['backend'],
  source_type: 'git',
  source_ref: 'https://github.com/user/repo.git',
  source_ref_resolved: 'https://github.com/user/repo.git',
  source_branch: 'main',
  source_subpath: 'skills/my-skill',
  last_checked_at: Date.now() - 3_600_000,
  update_status: 'update_available',
});

const skillsshSkill = createManagedSkill({
  id: 'sk-3',
  name: 'Market Skill',
  description: 'A marketplace skill',
  tags: [],
  source_type: 'skillssh',
  source_ref: 'https://github.com/market/react.git',
  source_ref_resolved: 'https://github.com/market/react.git',
  last_checked_at: Date.now() - 86_400_000,
});

const createdSkill = createManagedSkill({
  id: 'sk-4',
  name: 'Created Skill',
  description: 'Created in Neeko',
  source_type: 'local',
  source_ref: null,
});

describe('ViewSkillDialog', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('open=false no render', () => {
    render(<ViewSkillDialog open={false} skill={null} onClose={vi.fn()} />);
    expect(screen.queryByText('View Skill')).not.toBeInTheDocument();
  });

  it('关闭态常驻不产生全局副作用：不创建第二个 config owner', () => {
    // SkillContent 无条件挂载该 dialog（open=false）。若它自己调用旧 owner hook，
    // mount effect 会把主题重置为 DEFAULT_CONFIG.theme='dark' 再异步改回用户主题
    // ⇒ 整窗主题翻转（闪黑）。配置只有组合根一个 owner，dialog 只读不算。
    expectNoGlobalSideEffectsOnMount(() => {
      render(<ViewSkillDialog open={false} skill={null} onClose={vi.fn()} />);
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('loads document via store.getSkillDocument', async () => {
    render(<ViewSkillDialog open skill={localSkill} onClose={vi.fn()} />);

    expect(mockInvoke).toHaveBeenCalledWith('get_skill_document', { skillId: 'sk-1' });
    await waitFor(() => {
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
    });
  });

  it('renders markdown content after loading', async () => {
    render(<ViewSkillDialog open skill={localSkill} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Skill Content');
    });
  });

  it('shows skill tags', async () => {
    render(<ViewSkillDialog open skill={localSkill} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('react')).toBeInTheDocument();
      expect(screen.getByText('frontend')).toBeInTheDocument();
    });
  });

  it('calls onClose when Close clicked', async () => {
    const onClose = vi.fn();
    render(<ViewSkillDialog open skill={localSkill} onClose={onClose} />);
    await screen.findByText('Close');
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  describe('source info for local skill with original path', () => {
    it('shows source_ref with reveal button', async () => {
      render(<ViewSkillDialog open skill={localSkill} onClose={vi.fn()} />);

      await screen.findByRole('button', { name: /source/i });
      fireEvent.click(screen.getByRole('button', { name: /source/i }));

      expect(screen.getByText('/Users/user/original/skill-dir')).toBeInTheDocument();
    });
  });

  describe('source info for local skill created in Neeko', () => {
    it('shows Created in Neeko label in source section', async () => {
      render(<ViewSkillDialog open skill={createdSkill} onClose={vi.fn()} />);

      await screen.findByRole('button', { name: /source/i });
      fireEvent.click(screen.getByRole('button', { name: /source/i }));

      const labels = screen.getAllByText('Created in Neeko');
      expect(labels.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('source info for git skill', () => {
    it('shows repository URL with open button', async () => {
      render(<ViewSkillDialog open skill={gitSkill} onClose={vi.fn()} />);

      await screen.findByRole('button', { name: /source/i });
      fireEvent.click(screen.getByRole('button', { name: /source/i }));

      expect(screen.getByText('https://github.com/user/repo.git')).toBeInTheDocument();
    });

    it('shows branch name', async () => {
      render(<ViewSkillDialog open skill={gitSkill} onClose={vi.fn()} />);

      await screen.findByRole('button', { name: /source/i });
      fireEvent.click(screen.getByRole('button', { name: /source/i }));

      expect(screen.getByText('main')).toBeInTheDocument();
    });

    it('shows subpath', async () => {
      render(<ViewSkillDialog open skill={gitSkill} onClose={vi.fn()} />);

      await screen.findByRole('button', { name: /source/i });
      fireEvent.click(screen.getByRole('button', { name: /source/i }));

      expect(screen.getByText('skills/my-skill')).toBeInTheDocument();
    });

    it('shows last checked time', async () => {
      render(<ViewSkillDialog open skill={gitSkill} onClose={vi.fn()} />);

      await screen.findByRole('button', { name: /source/i });
      fireEvent.click(screen.getByRole('button', { name: /source/i }));

      expect(screen.getByText('1h ago')).toBeInTheDocument();
    });
  });

  describe('source info for skillssh skill', () => {
    it('shows repository URL with open button', async () => {
      render(<ViewSkillDialog open skill={skillsshSkill} onClose={vi.fn()} />);

      await screen.findByRole('button', { name: /source/i });
      fireEvent.click(screen.getByRole('button', { name: /source/i }));

      expect(screen.getByText('https://github.com/market/react.git')).toBeInTheDocument();
    });

    it('shows last checked time', async () => {
      render(<ViewSkillDialog open skill={skillsshSkill} onClose={vi.fn()} />);

      await screen.findByRole('button', { name: /source/i });
      fireEvent.click(screen.getByRole('button', { name: /source/i }));

      expect(screen.getByText('1d ago')).toBeInTheDocument();
    });
  });

  it('shows central path with reveal button for all skill types', async () => {
    render(<ViewSkillDialog open skill={localSkill} onClose={vi.fn()} />);

    await screen.findByRole('button', { name: /source/i });
    fireEvent.click(screen.getByRole('button', { name: /source/i }));

    expect(screen.getByText('/path/to/skill')).toBeInTheDocument();
  });
});
