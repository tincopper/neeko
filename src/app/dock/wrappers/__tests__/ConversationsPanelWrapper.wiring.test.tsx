import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/contexts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/contexts')>();
  return { ...actual, useAppContext: () => ({ agents: [], showToast: vi.fn() }) };
});

import { panelView } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { ConversationsPanelWrapper } from '../ConversationsPanelWrapper';

/**
 * 生产接线级验收：**History 面板的范围是项目身份，不是「当前单元路径」**。
 *
 * 修之前这里是 `worktreePath ?? project.path` —— 一条从前端当前视图推出的路径。
 * 后果不是「少一条分支」，而是结构性的：团队根按设计落在项目目录之外
 * （`~/.neeko/worktrees/<name>`），路径前缀永远匹配不上，于是「在这个工作树上开的团队」
 * 的 transcript 在 History 里根本不存在。路径是项目的一个属性，不是它的身份（红线 12）。
 *
 * | 判据 | 少了它会怎样 |
 * | --- | --- |
 * | `list_conversations` 收到 `{kind:'project', projectId}`（不是 path）| 后端只能按路径过滤 ⇒ 外部工作树的会话丢失 |
 * | `scan_conversations` 第二个参数是 `projectId` | 扫描只覆盖当前单元 ⇒ 列表永远缺另一个工作区 |
 * | 同一项目内切工作区**不重拉**列表 | 一次切换多两次 IPC，且用户看到列表闪一次（其实范围没变）|
 * | 换项目才重拉 | 列表不刷新 ⇒ 看到上一个项目的会话 |
 * | 没有激活项目 ⇒ 零 IPC | 空态按钮之外还发一次必然失败的请求 |
 */
const mockInvoke = vi.mocked(invoke);
const P1 = 'p1' as ProjectId;
const P2 = 'p2' as ProjectId;

/** 所有 `list_conversations` 调用的 scope 参数。 */
function listScopes(): unknown[] {
  return mockInvoke.mock.calls
    .filter(([cmd]) => cmd === 'list_conversations')
    .map(([, args]) => (args as { scope: unknown }).scope);
}

/** 所有 `scan_conversations` 调用的入参。 */
function scanPayloads(): unknown[] {
  return mockInvoke.mock.calls
    .filter(([cmd]) => cmd === 'scan_conversations')
    .map(([, args]) => args);
}

function setActiveProject(id: ProjectId, path: string): void {
  useProjectStore.setState({
    activeProjectId: id,
    activeProject: createProject({ id, path }),
  });
}

describe('ConversationsPanelWrapper — 历史按项目身份归属', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useWorkspaceStore.setState({ byProject: {} });
    setActiveProject(P1, '/repo/main');
    // 面板可见性门控 = `isViewVisible`（槽前台 + 展开）：把 History 拎到右槽前台。
    // 不做这一步，hook 的 `isActive` 恒 false，一条 IPC 都不会发 —— 测的就不是接线了。
    useDockStore.getState().moveView(panelView('conversations'), 'right', 0);
    useDockStore.getState().activateView(panelView('conversations'));
    useDockStore.getState().setSlotExpanded('right', true);
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'list_conversations') {
        return { items: [], total: 0, offset: 0, limit: 40, hasMore: false };
      }
      if (cmd === 'scan_conversations') return [];
      return undefined;
    });
  });

  it('列表与扫描都只拿 projectId（不是路径）', async () => {
    render(<ConversationsPanelWrapper />);

    await waitFor(() => {
      expect(listScopes().length).toBeGreaterThan(0);
      expect(scanPayloads().length).toBeGreaterThan(0);
    });

    // 项目级 = 该项目的**全部**工作区（后端按注册根解析），所以这里没有路径。
    expect(listScopes()).toEqual(expect.arrayContaining([{ kind: 'project', projectId: P1 }]));
    expect(scanPayloads()).toEqual(expect.arrayContaining([{ agentId: undefined, projectId: P1 }]));
    // 反向判据：路径一个都不许出现在载荷里（否则「按当前单元」的老行为悄悄回来了）。
    expect(JSON.stringify(mockInvoke.mock.calls)).not.toContain('/repo/main');
  });

  it('同一项目内切换工作区：不重拉列表（范围没变）', async () => {
    render(<ConversationsPanelWrapper />);

    await waitFor(() => {
      expect(listScopes().length).toBeGreaterThan(0);
    });
    const listCallsBefore = listScopes().length;
    const scanCallsBefore = scanPayloads().length;

    // 切到一个 linked worktree（同一项目的另一个工作区）。
    await act(async () => {
      useWorkspaceStore.getState().setActiveWorkspace(P1, '/repo/worktrees/feat-x', 'feat-x');
    });

    // 同一个 projectId ⇒ 同一个加载键 ⇒ 一次新的 IPC 都不该发。
    expect(listScopes().length).toBe(listCallsBefore);
    expect(scanPayloads().length).toBe(scanCallsBefore);
    expect(useWorkspaceStore.getState().byProject[P1]?.activePath).toBe('/repo/worktrees/feat-x');
  });

  it('换项目才重拉，且用新项目的身份', async () => {
    render(<ConversationsPanelWrapper />);

    await waitFor(() => {
      expect(listScopes()).toEqual(expect.arrayContaining([{ kind: 'project', projectId: P1 }]));
    });

    await act(async () => {
      setActiveProject(P2, '/repo/other');
    });

    await waitFor(() => {
      expect(listScopes()).toEqual(expect.arrayContaining([{ kind: 'project', projectId: P2 }]));
    });
  });

  it('没有激活项目：空态理由可见，且一次 list / scan 都不发', async () => {
    useProjectStore.setState({ activeProjectId: null, activeProject: null });

    render(<ConversationsPanelWrapper />);

    // 置灰必须有**可见文字理由**（空态句，而不是一个啥也不显示的空白面板）。
    expect(await screen.findByText('No project selected')).toBeVisible();
    expect(listScopes()).toEqual([]);
    expect(scanPayloads()).toEqual([]);
  });
});
