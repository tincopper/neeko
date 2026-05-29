import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SkillSearchInput from '../SkillSearchInput';

describe('SkillSearchInput', () => {
  it('渲染搜索图标和输入框', () => {
    render(<SkillSearchInput value="" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('显示传入的 value', () => {
    render(<SkillSearchInput value="hello" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('hello');
  });

  it('输入时触发 onChange 回调', () => {
    const onChange = vi.fn();
    render(<SkillSearchInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test' } });
    expect(onChange).toHaveBeenCalledWith('test');
  });

  it('支持自定义 placeholder', () => {
    render(<SkillSearchInput value="" onChange={vi.fn()} placeholder="Search skills..." />);
    expect(screen.getByPlaceholderText('Search skills...')).toBeInTheDocument();
  });

  it('clearable=false 时不显示清除按钮', () => {
    render(<SkillSearchInput value="some text" onChange={vi.fn()} clearable={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('clearable=true 且 value 非空时显示清除按钮', () => {
    render(<SkillSearchInput value="some text" onChange={vi.fn()} clearable />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('value 为空时即使 clearable=true 也不显示清除按钮', () => {
    render(<SkillSearchInput value="" onChange={vi.fn()} clearable />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('点击清除按钮时触发 onChange("")', () => {
    const onChange = vi.fn();
    render(<SkillSearchInput value="some text" onChange={onChange} clearable />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
