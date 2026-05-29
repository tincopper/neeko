import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useSkillStore, initialSkillState } from '../../../../store/skillStore';
import { createDiscoveredSkill } from '../../../../testing/factories';
import LocalSkillContent from '../LocalSkillContent';
import type { SkillDialogState } from '../skillItemTypes';

const mockInvoke = vi.mocked(invoke);

// stub 重型子组件，专注测试 LocalSkillContent 组合行为
vi.mock('../SkillListSection', () => ({
  default: () => <div data-testid="skill-list-section">SkillListSection</div>,
}));
vi.mock('../MarkdownEditor', () => ({
  default: () => <div data-testid="markdown-editor">MarkdownEditor</div>,
}));

beforeEach(() => {
  useSkillStore.setState(initialSkillState);
  mockInvoke.mockReset();
});

// ─── 辅助 ────────────────────────────────────────────────────────────────────

function renderComponent(setDialog = vi.fn<[SkillDialogState], void>()) {
  const result = render(<LocalSkillContent setDialog={setDialog} />);
  return { ...result, setDialog };
}

// ─── 测试 ────────────────────────────────────────────────────────────────────

describe('LocalSkillContent', () => {
  it('渲染 SkillHeader 中的操作按钮', () => {
    renderComponent();
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByText('Install')).toBeInTheDocument();
    expect(screen.getByText('Scan')).toBeInTheDocument();
  });

  it('渲染搜索框', () => {
    renderComponent();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('渲染 SkillListSection', () => {
    renderComponent();
    expect(screen.getByTestId('skill-list-section')).toBeInTheDocument();
  });

  it('点击 Create 按钮调用 setDialog({ type: "create" })', () => {
    const { setDialog } = renderComponent();
    fireEvent.click(screen.getByText('Create'));
    expect(setDialog).toHaveBeenCalledWith({ type: 'create' });
  });

  it('discoveredSkills 非空时渲染 DiscoveredSkillsList', async () => {
    const discovered = [createDiscoveredSkill({ id: 'd1', name_guess: 'My Skill' })];
    mockInvoke.mockResolvedValue(discovered);

    renderComponent();
    fireEvent.click(screen.getByText('Scan'));

    await waitFor(() => {
      expect(screen.getByText('My Skill')).toBeInTheDocument();
    });
  });

  it('初始时不渲染 DiscoveredSkillsList', () => {
    renderComponent();
    expect(screen.queryByText(/Discovered/)).toBeNull();
  });
});
