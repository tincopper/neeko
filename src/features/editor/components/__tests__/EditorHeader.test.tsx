import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EditorHeader from '../EditorHeader';

const baseProps = {
  filePath: 'README.md',
  projectPath: '/proj',
  isDirty: false,
  isMd: true,
  isHtml: false,
  isSvg: false,
  isJson: false,
  previewMode: 'translate' as const,
  onTogglePreview: vi.fn(),
  translatable: true,
  onViewModeChange: vi.fn(),
};

describe('EditorHeader — 三段式视图切换', () => {
  it('translate 模式下点击 Source / Preview 回调对应模式', () => {
    const onViewModeChange = vi.fn();
    render(<EditorHeader {...baseProps} onViewModeChange={onViewModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(onViewModeChange).toHaveBeenCalledWith('source');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onViewModeChange).toHaveBeenCalledWith('preview');
  });

  it('preview 模式下点击 Translate 回调 translate', () => {
    const onViewModeChange = vi.fn();
    render(
      <EditorHeader {...baseProps} previewMode="preview" onViewModeChange={onViewModeChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(onViewModeChange).toHaveBeenCalledWith('translate');
  });
});
