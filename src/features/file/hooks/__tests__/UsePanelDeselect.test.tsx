import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePanelDeselect } from '../usePanelDeselect';

function Harness({
  handleSelectNode,
  clearSelection,
}: {
  handleSelectNode: (path: string, isDir: boolean) => void;
  clearSelection: () => void;
}) {
  const { panelRef, handlePanelBackgroundClick } = usePanelDeselect({
    handleSelectNode,
    clearSelection,
  });
  return (
    <div
      ref={panelRef}
      role="presentation"
      onClick={handlePanelBackgroundClick}
      data-testid="panel"
    >
      <div data-testid="blank" />
      <button type="button" data-testid="btn">
        Btn
      </button>
    </div>
  );
}

describe('usePanelDeselect', () => {
  it('点击面板空白（非交互区域）选中项目根', () => {
    const handleSelectNode = vi.fn();
    render(<Harness handleSelectNode={handleSelectNode} clearSelection={vi.fn()} />);
    fireEvent.click(screen.getByTestId('blank'));
    expect(handleSelectNode).toHaveBeenCalledWith('', true);
  });

  it('点击面板内交互控件不触发选中根', () => {
    const handleSelectNode = vi.fn();
    render(<Harness handleSelectNode={handleSelectNode} clearSelection={vi.fn()} />);
    fireEvent.click(screen.getByTestId('btn'));
    expect(handleSelectNode).not.toHaveBeenCalled();
  });

  it('点击面板内不触发全局清除，点击面板外触发', () => {
    const clearSelection = vi.fn();
    render(<Harness handleSelectNode={vi.fn()} clearSelection={clearSelection} />);
    fireEvent.click(screen.getByTestId('blank'));
    expect(clearSelection).not.toHaveBeenCalled();

    fireEvent.click(document.body);
    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  it('卸载后移除 document 点击监听', () => {
    const clearSelection = vi.fn();
    const { unmount } = render(
      <Harness handleSelectNode={vi.fn()} clearSelection={clearSelection} />,
    );
    unmount();
    fireEvent.click(document.body);
    expect(clearSelection).not.toHaveBeenCalled();
  });
});
