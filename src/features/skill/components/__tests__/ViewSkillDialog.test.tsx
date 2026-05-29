import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useSkillStore, initialSkillState } from '../../store';
import { createManagedSkill } from '../../../../testing/factories';
import ViewSkillDialog from '../ViewSkillDialog';

const mockInvoke = vi.mocked(invoke);

// stub MarkdownPreview 避免渲染复杂度
vi.mock('@/ui/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}));

beforeEach(() => {
  useSkillStore.setState(initialSkillState);
  mockInvoke.mockReset();
  // useAppConfig 内部调用 load_config
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'load_config') return {};
    if (cmd === 'get_skill_document') return { content: '# Skill Content' };
    return undefined;
  });
});

const skill = createManagedSkill({
  id: 'sk-1',
  name: 'View Skill',
  description: 'A great skill',
  tags: ['react', 'frontend'],
});

describe('ViewSkillDialog', () => {
  it('open=false 时不渲染内容', () => {
    render(<ViewSkillDialog open={false} skill={null} onClose={vi.fn()} />);
    expect(screen.queryByText('View Skill')).toBeNull();
  });

  it('open=true 时通过 store.getSkillDocument 加载文档', async () => {
    render(<ViewSkillDialog open skill={skill} onClose={vi.fn()} />);

    expect(mockInvoke).toHaveBeenCalledWith('get_skill_document', { skillId: 'sk-1' });
    await waitFor(() => {
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
    });
  });

  it('加载完成后渲染 markdown 内容', async () => {
    render(<ViewSkillDialog open skill={skill} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Skill Content');
    });
  });

  it('显示 skill 的 tags', async () => {
    render(<ViewSkillDialog open skill={skill} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('react')).toBeInTheDocument();
      expect(screen.getByText('frontend')).toBeInTheDocument();
    });
  });

  it('点击 Close 时调用 onClose', async () => {
    const onClose = vi.fn();
    render(<ViewSkillDialog open skill={skill} onClose={onClose} />);
    await waitFor(() => screen.getByText('Close'));
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
