import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EntryPoint, LaunchConfig } from '../../types';
import DebugRunDropdown from '../DebugRunDropdown';

const ENTRY: EntryPoint = {
  id: 'e1',
  name: 'server',
  language: 'go',
  program: './cmd/server',
  programTemplate: './cmd/server',
  runCommand: 'go run ./cmd/server',
  configName: 'Debug server',
  adapterType: 'go',
};

const CONFIG: LaunchConfig = {
  name: 'Debug server',
  type: 'go',
  request: 'launch',
  program: './cmd/api',
};

function setup(overrides: Partial<React.ComponentProps<typeof DebugRunDropdown>> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onDebugEntry: vi.fn(),
    onRunEntry: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onAdd: vi.fn(),
  };
  render(
    <DebugRunDropdown
      entries={[ENTRY]}
      configs={[CONFIG]}
      selectedConfigName={CONFIG.name}
      canAdd
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('DebugRunDropdown — 纯展示（props 进 / 回调出）', () => {
  it('渲染入口点与配置，并标出选中项', () => {
    setup();
    // 入口点：名称 + language · template
    expect(screen.getByText('server')).toBeInTheDocument();
    expect(screen.getByText('go · ./cmd/server')).toBeInTheDocument();
    // 配置：名称 + type · program（program 与入口点故意不同，避免文本重复）
    expect(screen.getByText('Debug server')).toBeInTheDocument();
    expect(screen.getByText('go · ./cmd/api')).toBeInTheDocument();
    expect(screen.getByText('selected')).toBeInTheDocument();
  });

  it('点击配置行 → onSelect(name)', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledWith(CONFIG.name);
  });

  it('入口点的 Run / Debug 各自回调（Run 不触发 Debug）', () => {
    const { onRunEntry, onDebugEntry } = setup();
    fireEvent.click(screen.getByTitle('Run: go run ./cmd/server'));
    expect(onRunEntry).toHaveBeenCalledTimes(1);
    expect(onDebugEntry).not.toHaveBeenCalled();

    // 小按钮的 accessible name 是 'Debug'（行内主按钮的名字是入口名，故不冲突）。
    fireEvent.click(screen.getByRole('button', { name: 'Debug' }));
    expect(onDebugEntry).toHaveBeenCalledWith(ENTRY);
  });

  it('配置的 Edit / Delete 各自回调（带事件与目标配置）', () => {
    const { onEdit, onDelete } = setup();
    fireEvent.click(screen.getByTitle('Edit config'));
    expect(onEdit.mock.calls[0]?.[1]).toEqual(CONFIG);

    fireEvent.click(screen.getByTitle('Delete config'));
    expect(onDelete.mock.calls[0]?.[1]).toEqual(CONFIG);
  });

  it('无项目 → Add Config 禁用；有项目 → 触发 onAdd', () => {
    const { onAdd } = setup({ canAdd: false });
    const add = screen.getByTitle('Select a project first');
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('canAdd=true → Add Config 可点并触发 onAdd', () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByTitle('Add launch configuration'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('既无入口点也无配置 → 空态提示', () => {
    setup({ entries: [], configs: [], selectedConfigName: null });
    expect(screen.getByText('No launch configs or entry points found')).toBeInTheDocument();
  });
});
