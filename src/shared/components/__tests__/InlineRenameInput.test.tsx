import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import InlineRenameInput from '@/shared/components/InlineRenameInput';

/**
 * 受控包装：真实调用方（会话行 / worktree 行 / tag group 行）都自己持有草稿值，
 * 组件本身只负责「输入 → 上报」。
 */
function Harness({
  initial = '旧名字',
  onCommit = vi.fn(),
  onCancel = vi.fn(),
}: {
  initial?: string;
  onCommit?: () => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <InlineRenameInput value={value} onChange={setValue} onCommit={onCommit} onCancel={onCancel} />
  );
}

function inputEl(): HTMLInputElement {
  return screen.getByRole('textbox') as HTMLInputElement;
}

describe('InlineRenameInput — 行内重命名输入框（侧栏会话行 / worktree 行 / tag group 行共用）', () => {
  /**
   * focus + 全选是「行内重命名」这个行为的职责，不能留给每个调用方各写一份
   * （历史上三处各一份，第一份就漂移成了每键重新全选）。
   */
  it('挂载即聚焦并全选当前值', () => {
    render(<Harness initial="旧名字" />);

    const input = inputEl();
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('旧名字'.length);
  });

  /**
   * 回归用例：focus effect 一旦依赖 `value`，每敲一个字符就会重新 `select()`，
   * 下一个字符把整段替换掉 —— 表现为「输入框一直是全选状态，只能打出最后一个字」。
   */
  it('连续输入多个字符后得到完整字符串（不被重新全选覆盖）', async () => {
    const user = userEvent.setup();
    render(<Harness initial="旧名字" />);

    const input = inputEl();
    // `skipClick`：真实交互是「双击行 → 直接敲」，点击会把光标移到末尾（取消挂载时的全选）；
    // 逐字符输入才是这个回归的判据（旧实现每个字符都会重新全选 → 最终只剩最后一个字）。
    await user.type(input, '新名字', { skipClick: true });

    expect(input.value).toBe('新名字');
  });

  it('Enter 提交（回车不换行、不冒泡成行的快捷键）', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    fireEvent.keyDown(inputEl(), { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Escape 取消', () => {
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} onCancel={onCancel} />);

    fireEvent.keyDown(inputEl(), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('失焦提交（点走即确认，不需要额外按钮）', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    fireEvent.blur(inputEl());

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  /** 点击输入框不能冒泡成「选中该行 / 打开该单元的终端」。 */
  it('点击与双击不冒泡到行', () => {
    // 行级处理器（React 根容器）之后就是 `document`：事件能到 document 就说明没被拦下。
    const onDocClick = vi.fn();
    const onDocDoubleClick = vi.fn();
    document.addEventListener('click', onDocClick);
    document.addEventListener('dblclick', onDocDoubleClick);

    try {
      render(<Harness />);
      fireEvent.click(inputEl());
      fireEvent.doubleClick(inputEl());

      expect(onDocClick).not.toHaveBeenCalled();
      expect(onDocDoubleClick).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('dblclick', onDocDoubleClick);
    }
  });

  /** 复用 `ui/Input` 的直接收益：WebKit 自动大写 / 纠错 / 拼写检查一并继承。 */
  it('继承统一输入组件的 WebKit 关断属性', () => {
    render(<Harness />);

    const input = inputEl();
    expect(input).toHaveAttribute('autocapitalize', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
  });
});
