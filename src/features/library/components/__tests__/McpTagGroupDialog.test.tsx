import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMcpStore } from '@/features/library/store/mcpStore';

import McpTagGroupDialog from '../McpTagGroupDialog';

function openStore() {
  const createMcpTagGroup = vi.fn(async () => ({ id: 'tg-new', name: 'Backend' }));
  const updateMcpTagGroup = vi.fn(async () => ({ id: 'tg-1', name: 'Backend' }));
  useMcpStore.setState({
    createMcpTagGroup,
    updateMcpTagGroup,
    mcpTagGroups: [],
    mcpTagGroupsLoading: false,
    activeMcpTagGroup: null,
  });
  return { createMcpTagGroup, updateMcpTagGroup };
}

describe('McpTagGroupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('创建模式渲染标题与表单字段', () => {
    openStore();
    render(<McpTagGroupDialog open tagGroup={null} onClose={vi.fn()} />);

    expect(screen.getByText('New tag group')).toBeInTheDocument();
    expect(screen.getByLabelText('Name *')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('编辑模式预填 tagGroup 值', () => {
    openStore();
    render(
      <McpTagGroupDialog
        open
        tagGroup={{ id: 'tg-1', name: 'Backend', description: 'backend tools', icon: '🛠️' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Edit tag group')).toBeInTheDocument();
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Backend');
    expect((screen.getByLabelText('Icon') as HTMLInputElement).value).toBe('🛠️');
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('空 name 提交（Enter）显示错误且不调用 create', async () => {
    const { createMcpTagGroup } = openStore();
    render(<McpTagGroupDialog open tagGroup={null} onClose={vi.fn()} />);

    fireEvent.keyDown(screen.getByLabelText('Name *'), { key: 'Enter' });

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(createMcpTagGroup).not.toHaveBeenCalled();
  });

  it('创建提交调用 createMcpTagGroup', async () => {
    const { createMcpTagGroup } = openStore();
    render(<McpTagGroupDialog open tagGroup={null} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Backend' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'tools' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(createMcpTagGroup).toHaveBeenCalledWith({
        name: 'Backend',
        description: 'tools',
        icon: null,
      });
    });
  });

  it('编辑提交调用 updateMcpTagGroup', async () => {
    const { updateMcpTagGroup } = openStore();
    render(<McpTagGroupDialog open tagGroup={{ id: 'tg-1', name: 'Backend' }} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Frontend' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(updateMcpTagGroup).toHaveBeenCalledWith('tg-1', {
        name: 'Frontend',
        description: null,
        icon: null,
      });
    });
  });

  it('取消按钮调用 onClose', () => {
    openStore();
    const onClose = vi.fn();
    render(<McpTagGroupDialog open tagGroup={null} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
