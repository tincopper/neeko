import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';

import { useDebugStore } from '../../store/debugStore';
import DebugBreakpointsPane from '../DebugBreakpointsPane';

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ activeProject: { id: 'p1', path: '/proj' } as never });
  useDebugStore.setState({
    breakpoints: {
      p1: {
        '/proj/a.go': [
          { line: 10, enabled: true },
          { line: 20, enabled: false },
        ],
      },
    },
    breakpointsMuted: {},
  });
});

describe('DebugBreakpointsPane', () => {
  it('每行渲染 Eye/EyeOff 开关：enabled 行 Eye（aria-pressed=true）', () => {
    render(<DebugBreakpointsPane />);
    // line 10 enabled → Eye + aria-pressed=true
    const enable = screen.getByTitle('Disable breakpoint');
    expect(enable).toHaveAttribute('aria-pressed', 'true');
    // line 20 disabled → EyeOff + aria-pressed=false
    const disable = screen.getByTitle('Enable breakpoint');
    expect(disable).toHaveAttribute('aria-pressed', 'false');
  });

  it('点击 Eye 调 setBreakpointEnabled（不改存在性）', () => {
    const setBreakpointEnabled = vi
      .spyOn(useDebugStore.getState(), 'setBreakpointEnabled')
      .mockResolvedValue(undefined);
    render(<DebugBreakpointsPane />);

    fireEvent.click(screen.getByTitle('Disable breakpoint'));
    expect(setBreakpointEnabled).toHaveBeenCalledWith('p1', '/proj/a.go', 10, false);
    setBreakpointEnabled.mockRestore();
  });

  it('mute 下全行置灰（effective 折叠），Eye 全呈 EyeOff 但点击仍改单个位', () => {
    useDebugStore.setState({ breakpointsMuted: { p1: true } });
    const setBreakpointEnabled = vi
      .spyOn(useDebugStore.getState(), 'setBreakpointEnabled')
      .mockResolvedValue(undefined);
    render(<DebugBreakpointsPane />);

    // mute 下原本 enabled 的行也呈 EyeOff 态（视觉），但 aria-pressed 反映单个位。
    const toggles = screen.getAllByTitle('Enable breakpoint');
    expect(toggles.length).toBe(2);

    fireEvent.click(toggles[0]);
    expect(setBreakpointEnabled).toHaveBeenCalledWith('p1', '/proj/a.go', 10, false);
    setBreakpointEnabled.mockRestore();
  });

  it('X 删除保留', () => {
    const removeBreakpoint = vi
      .spyOn(useDebugStore.getState(), 'removeBreakpoint')
      .mockResolvedValue(undefined);
    render(<DebugBreakpointsPane />);

    const removeButtons = screen.getAllByTitle('Remove breakpoint');
    expect(removeButtons.length).toBe(2);
    fireEvent.click(removeButtons[0]);
    expect(removeBreakpoint).toHaveBeenCalled();
    removeBreakpoint.mockRestore();
  });
});
