import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UserInputPanel from '../UserInputPanel';

describe('UserInputPanel', () => {
  it('有选项时渲染 prompt 与选项', () => {
    render(
      <UserInputPanel
        prompt="Which approach?"
        options={['Option A', 'Option B', 'Option C']}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Which approach?')).toBeInTheDocument();
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
    expect(screen.getByText('Option C')).toBeInTheDocument();
  });

  it('单选模式：点击选项后自动提交', () => {
    const onSubmit = vi.fn();
    render(<UserInputPanel prompt="Choose one" options={['A', 'B', 'C']} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('B'));
    expect(onSubmit).toHaveBeenCalledWith(['B']);
  });

  it('多选模式：点击切换选中状态，需手动提交', () => {
    const onSubmit = vi.fn();
    render(
      <UserInputPanel
        prompt="Choose multiple"
        options={['A', 'B', 'C']}
        multiSelect
        onSubmit={onSubmit}
      />,
    );

    // 点击 A 和 C，不立即提交
    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText('C'));
    expect(onSubmit).not.toHaveBeenCalled();

    // 点击 Next 提交
    fireEvent.click(screen.getByText('Next →'));
    expect(onSubmit).toHaveBeenCalledWith(['A', 'C']);
  });

  it('多选模式：再次点击取消选中', () => {
    const onSubmit = vi.fn();
    render(<UserInputPanel prompt="Choose" options={['A', 'B']} multiSelect onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText('A')); // 取消选中
    fireEvent.click(screen.getByText('Next →'));
    expect(onSubmit).toHaveBeenCalledWith([]);
  });

  it('有选项时显示数字快捷键提示', () => {
    render(<UserInputPanel prompt="Choose" options={['A', 'B', 'C']} onSubmit={vi.fn()} />);

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('无选项时渲染自由文本输入', () => {
    render(<UserInputPanel prompt="What is your answer?" onSubmit={vi.fn()} />);

    expect(screen.getByText('What is your answer?')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type your answer...')).toBeInTheDocument();
    expect(screen.getByText('Send')).toBeInTheDocument();
  });

  it('自由文本输入：输入后点击 Send 提交', () => {
    const onSubmit = vi.fn();
    render(<UserInputPanel prompt="What?" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), {
      target: { value: 'my answer' },
    });
    fireEvent.click(screen.getByText('Send'));
    expect(onSubmit).toHaveBeenCalledWith(['my answer']);
  });
});
