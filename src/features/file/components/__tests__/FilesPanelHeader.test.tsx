// FilesPanelHeader 定位按钮：
// - 常驻工具栏（刷新按钮左侧），图标为 lucide Crosshair
// - 无文件 tab 打开时 disabled（置灰）
// - 点击触发 onLocateFile
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FilesPanelHeader from '../FilesPanelHeader';

function renderHeader(props: Partial<React.ComponentProps<typeof FilesPanelHeader>> = {}) {
  return render(
    <FilesPanelHeader
      projectName="demo"
      projectPath="/demo"
      activeFileName={null}
      activeFilePath={null}
      displayPath="/demo"
      onCollapseAll={() => {}}
      canCollapse={false}
      onRefresh={() => {}}
      {...props}
    />,
  );
}

describe('FilesPanelHeader 定位按钮', () => {
  it('渲染定位按钮，位于刷新按钮左侧', () => {
    renderHeader({ onLocateFile: vi.fn(), canLocateFile: true });

    const locate = screen.getByTitle('Locate current file');

    expect(locate).toBeInTheDocument();
    // 按钮顺序：... Collapse All → Locate → Refresh
    const titles = screen.getAllByRole('button').map((b) => b.getAttribute('title'));
    const locateIdx = titles.indexOf('Locate current file');
    const refreshIdx = titles.indexOf('Refresh file tree');
    expect(locateIdx).toBeGreaterThanOrEqual(0);
    expect(refreshIdx).toBeGreaterThan(locateIdx);
  });

  it('点击定位按钮触发 onLocateFile', () => {
    const onLocateFile = vi.fn();
    renderHeader({ onLocateFile, canLocateFile: true });

    fireEvent.click(screen.getByTitle('Locate current file'));
    expect(onLocateFile).toHaveBeenCalledTimes(1);
  });

  it('无文件打开时按钮置灰（disabled）', () => {
    renderHeader({ onLocateFile: vi.fn(), canLocateFile: false });

    expect(screen.getByTitle('Locate current file')).toBeDisabled();
  });

  it('未提供 onLocateFile 时不渲染按钮', () => {
    renderHeader({ canLocateFile: true });

    expect(screen.queryByTitle('Locate current file')).not.toBeInTheDocument();
  });
});
