import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useSkillStore, initialSkillState } from '../../../store/skillStore';
import { createManagedSkill } from '../../../testing/factories';
import EditSkillDialog from '../EditSkillDialog';

const mockInvoke = vi.mocked(invoke);

// stub MarkdownEditor 避免 CodeMirror DOM 依赖
vi.mock('../MarkdownEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="markdown-editor" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

beforeEach(() => {
  useSkillStore.setState(initialSkillState);
  mockInvoke.mockReset();
});

const skill = createManagedSkill({ id: 'sk-1', name: 'My Skill' });

describe('EditSkillDialog', () => {
  it('open=false 时不渲染内容', () => {
    render(<EditSkillDialog open={false} skill={null} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByText('Edit Skill')).toBeNull();
  });

  it('open=true 时通过 store.getSkillDocument 加载文档', async () => {
    mockInvoke.mockResolvedValue({ content: '# Hello' });
    render(<EditSkillDialog open skill={skill} onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(mockInvoke).toHaveBeenCalledWith('get_skill_document', { skillId: 'sk-1' });
    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toHaveValue('# Hello');
    });
  });

  it('加载中显示 Loading... 状态', () => {
    // mock 永不 resolve，保持 loading 状态
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<EditSkillDialog open skill={skill} onClose={vi.fn()} onConfirm={vi.fn()} />);
    const loadingElements = screen.getAllByText('Loading...');
    expect(loadingElements.length).toBeGreaterThan(0);
  });

  it('点击 Cancel 时调用 onClose', async () => {
    mockInvoke.mockResolvedValue({ content: '# content' });
    const onClose = vi.fn();
    render(<EditSkillDialog open skill={skill} onClose={onClose} onConfirm={vi.fn()} />);
    await waitFor(() => screen.getByText('Cancel'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('填写内容后点击 Save 时调用 onConfirm', async () => {
    mockInvoke.mockResolvedValue({ content: '# content' });
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<EditSkillDialog open skill={skill} onClose={vi.fn()} onConfirm={onConfirm} />);

    await waitFor(() => screen.getByText('Save'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith('My Skill', '# content');
    });
  });
});
