import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/shared/store/agentStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { LaunchableAgent } from '@/shared/types/team';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import {
  createAgent,
  createLaunchableAgent,
  createProject,
  createTeamSession,
  createTeamSnapshot,
} from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamGenerationForTests, useTeamStore } from '../../store/teamStore';
import TeamLaunchPanel from '../TeamLaunchPanel';

/**
 * 队长入口的能力面（`team_launchable_agents`）。
 *
 * 这一组用例守的是 prd R0.4：**能力缺口必须在 UI 上可见**，而不是让人点到必然失败的按钮。
 * 所以四条判据都是「用户能看到什么 / 点了会发生什么」：
 *
 * | 判据 | 少了它会怎样 |
 * | --- | --- |
 * | 被拒的行禁用 + 理由**可见** | 用户仍能选中 `pi`，点下去才吃 `Unsupported: …` |
 * | 被拒的行点击不触发 `start_team_session` | 键盘 / 回车绕过 `disabled` 时把必然失败的请求发出去 |
 * | 全部被拒 → 主按钮禁用 + 说明 | 灰按钮不说原因，看起来像面板坏了 |
 * | 空清单 → 明确空态 | 空下拉让人以为还在加载 |
 *
 * 候选**只**来自后端清单：这里 mock 的 `team_launchable_agents` 返回什么，面板就渲染什么。
 * 若面板另有一套前端判据（`enabled` + 有 `command`），下面「被拒的行照样渲染出来」的断言
 * 会先红 —— 这就是变异验证的落点。
 */

const mockInvoke = vi.mocked(invoke);

const PROJECT_PATH = '/repo/main';

function setActiveProject(path = PROJECT_PATH): void {
  const project = createProject({ id: 'p1' as ProjectId, path });
  useProjectStore.setState({ activeProjectId: project.id, activeProject: project });
}

function resetStores(): void {
  __resetTeamGenerationForTests();
  useTeamStore.setState({
    teamId: null,
    snapshot: null,
    detail: null,
    loading: false,
    error: null,
    lastRev: 0,
  });
  useProjectStore.setState({ activeProjectId: null, activeProject: null });
  useWorkspaceStore.setState({ byProject: {} });
  useAgentStore.setState({
    agents: [
      createAgent({ id: 'claude-code', name: 'Claude Code', command: 'claude' }),
      createAgent({ id: 'codex', name: 'Codex', command: 'codex' }),
      createAgent({ id: 'pi', name: 'Pi', command: 'pi', enabled: false }),
    ],
    loading: false,
  });
}

/** 让 `team_launchable_agents` 回这份清单，其余命令走默认成功路径。 */
function mockBackend(rows: LaunchableAgent[]): void {
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === 'team_launchable_agents') return rows;
    if (cmd === 'start_team_session') return createTeamSession();
    if (cmd === 'team_snapshot') return createTeamSnapshot();
    return undefined;
  });
}

const startCalls = (): unknown[][] =>
  mockInvoke.mock.calls.filter(([cmd]) => cmd === 'start_team_session');

/** 面板挂载后要先等清单落地（按钮按清单渲染）。 */
async function waitForList(): Promise<void> {
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('team_launchable_agents'));
  await waitFor(() =>
    expect(screen.queryByText('正在检查各 CLI 的启动能力…')).not.toBeInTheDocument(),
  );
}

const PI_REFUSAL =
  'Unsupported: agent `pi` injects MCP via Subcommand, which the executor does not implement yet';

describe('TeamLaunchPanel — 能力面（team_launchable_agents）', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
    setActiveProject();
  });

  it('被拒的 CLI 禁用、理由作为可见文字渲染，点击不触发 start_team_session', async () => {
    mockBackend([
      createLaunchableAgent({ agentId: 'claude-code' }),
      createLaunchableAgent({ agentId: 'pi', refusal: PI_REFUSAL }),
    ]);

    render(<TeamLaunchPanel />);
    await waitForList();

    // 行本身仍然渲染出来 —— 静默隐藏会让用户以为「不支持」，实际是「我们没说」。
    const piRow = screen.getByRole('button', { name: /Pi/ });
    expect(piRow).toBeDisabled();
    expect(piRow).toHaveAttribute('aria-disabled', 'true');

    // 理由必须是**可见文字**（不是 title / aria-label 这种看不见的容器）。
    const reason = screen.getByText(PI_REFUSAL);
    expect(reason).toBeVisible();
    expect(piRow).not.toHaveAttribute('title');
    // 读屏也能把它挂在控件上（description 与可见文字是同一份）。
    expect(piRow).toHaveAttribute('aria-describedby', reason.id);

    // 可启动的那一行正常可选。
    expect(screen.getByRole('button', { name: /Claude Code/ })).toBeEnabled();

    // 点击被拒的行：不发任何启动请求。
    // （`invoke` 总数恒为 1 —— 只有挂载时那一次清单拉取。）
    fireEvent.click(piRow);
    expect(startCalls()).toHaveLength(0);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('可启动的 CLI 点击后用正确的 agentId 调 start_team_session', async () => {
    mockBackend([
      createLaunchableAgent({ agentId: 'claude-code' }),
      createLaunchableAgent({ agentId: 'codex' }),
    ]);

    render(<TeamLaunchPanel />);
    await waitForList();

    // 选第二个：证明 agentId 来自用户选择，而不是硬编码第一个。
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    fireEvent.click(screen.getByRole('button', { name: '以队长身份开会话' }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('start_team_session', {
        agentId: 'codex',
        projectPath: PROJECT_PATH,
        name: null,
      }),
    );
  });

  it('默认选中第一个**可启动的**（被拒的行排在前面也不抢默认值）', async () => {
    mockBackend([
      createLaunchableAgent({ agentId: 'pi', refusal: PI_REFUSAL }),
      createLaunchableAgent({ agentId: 'claude-code' }),
    ]);

    render(<TeamLaunchPanel />);
    await waitForList();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Claude Code/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByRole('button', { name: /Pi/ })).not.toHaveAttribute('aria-pressed');

    fireEvent.click(screen.getByRole('button', { name: '以队长身份开会话' }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('start_team_session', {
        agentId: 'claude-code',
        projectPath: PROJECT_PATH,
        name: null,
      }),
    );
  });

  it('全部被拒：主按钮禁用并说明原因，点击也不发启动请求', async () => {
    mockBackend([
      createLaunchableAgent({
        agentId: 'dsh',
        refusal: 'agent `dsh` is not in the team admission table',
      }),
      createLaunchableAgent({ agentId: 'pi', refusal: PI_REFUSAL }),
    ]);

    render(<TeamLaunchPanel />);
    await waitForList();

    const cta = screen.getByRole('button', { name: '以队长身份开会话' });
    expect(cta).toBeDisabled();
    expect(screen.getByText(/清单里的 CLI 现在都不能启动/)).toBeVisible();

    fireEvent.click(cta);
    expect(startCalls()).toHaveLength(0);
  });

  it('后端返回空数组：明确空态（不是空下拉，也不是加载中）', async () => {
    mockBackend([]);

    render(<TeamLaunchPanel />);
    await waitForList();

    expect(screen.getByText(/后端没有返回任何可选的 CLI/)).toBeVisible();
    expect(screen.queryByRole('list', { name: '可选的 CLI' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '以队长身份开会话' })).toBeDisabled();
  });

  it('清单拉取失败：显示后端原文，不渲染空下拉', async () => {
    mockInvoke.mockRejectedValueOnce('Not found: agent manager is not initialised');

    render(<TeamLaunchPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not found: agent manager is not initialised');
    expect(screen.queryByRole('list', { name: '可选的 CLI' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '以队长身份开会话' })).toBeDisabled();

    // 首次拉取就失败时也必须能重试（否则用户只能重开面板）。
    mockInvoke.mockResolvedValueOnce([createLaunchableAgent({ agentId: 'claude-code' })]);
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    expect(await screen.findByRole('button', { name: /Claude Code/ })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('没有活动项目时主按钮禁用并说明原因', async () => {
    useProjectStore.setState({ activeProjectId: null, activeProject: null });
    mockBackend([createLaunchableAgent({ agentId: 'claude-code' })]);

    render(<TeamLaunchPanel />);
    await waitForList();

    expect(screen.getByRole('button', { name: '以队长身份开会话' })).toBeDisabled();
    expect(screen.getByText(/没有活动项目（先选择一个项目）。/)).toBeVisible();
  });
});
