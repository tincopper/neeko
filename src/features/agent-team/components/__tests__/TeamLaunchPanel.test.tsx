import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/shared/store/agentStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { LaunchableAgent, TeamOptions } from '@/shared/types/team';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import {
  createAgent,
  createLaunchableAgent,
  createProject,
  createTeamDefaults,
  createTeamOptions,
  createTeamSession,
  createTeamSnapshot,
} from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamGenerationForTests, useTeamStore } from '../../store/teamStore';
import TeamLaunchPanel from '../TeamLaunchPanel';

/**
 * 队长入口：能力面（`team_launchable_agents`）+ 团队配置区（`team_options`）。
 *
 * 第一组守 prd R0.4：**能力缺口必须在 UI 上可见**，而不是让人点到必然失败的按钮。
 *
 * | 判据 | 少了它会怎样 |
 * | --- | --- |
 * | 被拒的行禁用 + 理由**可见** | 用户仍能选中 `pi`，点下去才吃 `Unsupported: …` |
 * | 被拒的行点击不触发 `start_team_session` | 键盘 / 回车绕过 `disabled` 时把必然失败的请求发出去 |
 * | 全部被拒 → 主按钮禁用 + 说明 | 灰按钮不说原因，看起来像面板坏了 |
 * | 空清单 → 明确空态 | 空下拉让人以为还在加载 |
 *
 * 第二组守「团队配置」的真相源：**默认值只能来自 `team_options(null)`**。
 *
 * | 判据 | 少了它会怎样 |
 * | --- | --- |
 * | 表单初值取自 `options.defaults`（用例里改成 7 / 只读 / 逐个交互）| 前端写死 4 / shared / queue，后端改默认值后没人发现 |
 * | 至少一个成员才能提交 | 空池在后端是「**不限制**」——用户以为「一个都不要」，实际是「全都能进」|
 * | `config` 只含**改过**的字段 | 把 `TeamDefaults` 原样回传 = 把后端默认值抄成前端常量 |
 * | 上限越界即时拦 | 后端会在写库前拒绝，但 UI 不该把必败请求发出去 |
 * | `bypass` 有可见风险提示 | 旁路审批是不隐蔽的显式动作（design §6.1）|
 * | `team_options` 失败 → 主按钮不可用 | 前端用自造默认值兜底，等于第二份默认值 |
 */

const mockInvoke = vi.mocked(invoke);

const PROJECT_PATH = '/repo/main';

const MANAGER_DOWN = 'Not found: agent manager is not initialised';

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

interface BackendScript {
  /** `team_launchable_agents` 的行（缺省 = 单个可启动的 `claude-code`）。 */
  agents?: LaunchableAgent[];
  /** `team_options` 的载荷（缺省 = 与 `agents` 同集合、后端真实缺省值）。 */
  options?: TeamOptions;
  /** `true` = 该命令直接拒绝（`MANAGER_DOWN`），用于失败/重试用例。 */
  agentsFail?: boolean;
  optionsFail?: boolean;
}

/** 让 `team_*` 命令按脚本应答，其余命令走默认成功路径。 */
function mockBackend(script: BackendScript = {}): void {
  const agents = script.agents ?? [createLaunchableAgent({ agentId: 'claude-code' })];
  // 缺省池子只含**可启动**的行：Rust 侧 `options.rs::resolve` 会滤掉被拒的行，
  // 所以「被拒的 CLI 也出现在 `members` 里」必须由用例显式构造（防守分支）。
  const options =
    script.options ?? createTeamOptions({ members: agents.filter((row) => row.refusal === null) });
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === 'team_launchable_agents') {
      if (script.agentsFail) throw MANAGER_DOWN;
      return agents;
    }
    if (cmd === 'team_options') {
      if (script.optionsFail) throw MANAGER_DOWN;
      return options;
    }
    if (cmd === 'start_team_session') return createTeamSession();
    if (cmd === 'team_snapshot') return createTeamSnapshot();
    return undefined;
  });
}

const startCalls = (): unknown[][] =>
  mockInvoke.mock.calls.filter(([cmd]) => cmd === 'start_team_session');

/** `start_team_session` 的入参（最后一次调用）。 */
function lastStartPayload(): {
  agentId: string;
  projectPath: string;
  name: unknown;
  config: Record<string, unknown>;
} {
  const calls = startCalls();
  expect(calls).toHaveLength(1);
  return calls[0][1] as {
    agentId: string;
    projectPath: string;
    name: unknown;
    config: Record<string, unknown>;
  };
}

/** 面板挂载后要先等两条读命令落地（按钮与配置区都按它们渲染）。 */
async function waitForPanelReady(): Promise<void> {
  // 队长入口问的是**队长**判据（多一条「能不能收到角色 preamble」），不是成员判据。
  await waitFor(() =>
    expect(mockInvoke).toHaveBeenCalledWith('team_launchable_agents', { role: 'lead' }),
  );
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('team_options', { teamId: null }));
  await waitFor(() =>
    expect(screen.queryByText(/正在读取团队配置的默认值…/)).not.toBeInTheDocument(),
  );
}

/** 等配置表单真正渲染出来（草稿要从 `defaults` 播种后才不是 `null`）。 */
async function waitForConfigForm(): Promise<HTMLElement> {
  return screen.findByRole('spinbutton', { name: /成员上限/ });
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
    mockBackend({
      agents: [
        createLaunchableAgent({ agentId: 'claude-code' }),
        createLaunchableAgent({ agentId: 'pi', refusal: PI_REFUSAL }),
      ],
    });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();

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

    // 点击被拒的行：不发任何新请求（两次挂载读命令已发生过，不重复）。
    const callsBefore = mockInvoke.mock.calls.length;
    fireEvent.click(piRow);
    expect(startCalls()).toHaveLength(0);
    expect(mockInvoke.mock.calls).toHaveLength(callsBefore);
  });

  it('可启动的 CLI 点击后用正确的 agentId 调 start_team_session', async () => {
    mockBackend({
      agents: [
        createLaunchableAgent({ agentId: 'claude-code' }),
        createLaunchableAgent({ agentId: 'codex' }),
      ],
    });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();
    await waitForConfigForm();

    // 选第二个：证明 agentId 来自用户选择，而不是硬编码第一个。
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    fireEvent.click(screen.getByRole('button', { name: '以队长身份开会话' }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('start_team_session', {
        agentId: 'codex',
        projectPath: PROJECT_PATH,
        name: null,
        // 一个字都没改 ⇒ 载荷里没有任何覆盖项（不是一份抄来的默认值）。
        config: {},
      }),
    );
  });

  it('默认选中第一个**可启动的**（被拒的行排在前面也不抢默认值）', async () => {
    mockBackend({
      agents: [
        createLaunchableAgent({ agentId: 'pi', refusal: PI_REFUSAL }),
        createLaunchableAgent({ agentId: 'claude-code' }),
      ],
    });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Claude Code/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByRole('button', { name: /Pi/ })).not.toHaveAttribute('aria-pressed');

    await waitForConfigForm();
    fireEvent.click(screen.getByRole('button', { name: '以队长身份开会话' }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('start_team_session', {
        agentId: 'claude-code',
        projectPath: PROJECT_PATH,
        name: null,
        config: {},
      }),
    );
  });

  it('全部被拒：主按钮禁用并说明原因，点击也不发启动请求', async () => {
    mockBackend({
      agents: [
        createLaunchableAgent({
          agentId: 'dsh',
          refusal: 'agent `dsh` is not in the team admission table',
        }),
        createLaunchableAgent({ agentId: 'pi', refusal: PI_REFUSAL }),
      ],
    });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();

    const cta = screen.getByRole('button', { name: '以队长身份开会话' });
    expect(cta).toBeDisabled();
    expect(screen.getByText(/清单里的 CLI 现在都不能启动/)).toBeVisible();

    fireEvent.click(cta);
    expect(startCalls()).toHaveLength(0);
  });

  it('后端返回空数组：明确空态（不是空下拉，也不是加载中）', async () => {
    mockBackend({ agents: [], options: createTeamOptions({ members: [] }) });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();

    expect(screen.getByText(/后端没有返回任何可选的 CLI/)).toBeVisible();
    expect(screen.queryByRole('list', { name: '可选的 CLI' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '以队长身份开会话' })).toBeDisabled();
  });

  it('清单拉取失败：显示后端原文，不渲染空下拉', async () => {
    let failOnce = true;
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_launchable_agents') {
        if (failOnce) {
          failOnce = false;
          throw MANAGER_DOWN;
        }
        return [createLaunchableAgent({ agentId: 'claude-code' })];
      }
      if (cmd === 'team_options') return createTeamOptions();
      if (cmd === 'team_snapshot') return createTeamSnapshot();
      return createTeamSession();
    });

    render(<TeamLaunchPanel />);

    // 两条读命令都可能失败：这里只关心「清单那一侧」的原文与重试。
    expect(await screen.findByText(MANAGER_DOWN)).toBeVisible();
    expect(screen.queryByRole('list', { name: '可选的 CLI' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '以队长身份开会话' })).toBeDisabled();

    // 首次拉取就失败时也必须能重试（否则用户只能重开面板）。
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    expect(await screen.findByRole('button', { name: /Claude Code/ })).toBeEnabled();
    expect(screen.queryByText(MANAGER_DOWN)).not.toBeInTheDocument();
  });

  it('没有活动项目时主按钮禁用并说明原因', async () => {
    useProjectStore.setState({ activeProjectId: null, activeProject: null });
    mockBackend({ agents: [createLaunchableAgent({ agentId: 'claude-code' })] });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();

    expect(screen.getByRole('button', { name: '以队长身份开会话' })).toBeDisabled();
    expect(screen.getByText(/没有活动项目（先选择一个项目）。/)).toBeVisible();
  });
});

describe('TeamLaunchPanel — 团队配置（team_options）', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
    setActiveProject();
  });

  it('挂载时拉 team_options(teamId: null)，表单初值全部来自它', async () => {
    mockBackend({
      agents: [
        createLaunchableAgent({ agentId: 'claude-code' }),
        createLaunchableAgent({ agentId: 'codex' }),
      ],
      // 三个值都**不可能**是前端写死的：7 不在 {4}，只读不在 {shared}，逐个交互不在 {queue}。
      options: createTeamOptions({
        members: [
          createLaunchableAgent({ agentId: 'claude-code' }),
          createLaunchableAgent({ agentId: 'codex' }),
        ],
        defaults: createTeamDefaults({
          allowedAgentIds: ['claude-code', 'codex'],
          maxMembers: 7,
          defaultWorkspace: 'read_only',
          defaultApprovalPolicy: 'interactive',
        }),
      }),
    });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();

    expect(mockInvoke).toHaveBeenCalledWith('team_options', { teamId: null });

    const limit = await waitForConfigForm();
    expect(limit).toHaveValue(7);
    expect(screen.getByRole('radio', { name: /只读/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /逐个交互批准/ })).toBeChecked();
    // 池子按 `defaults.allowedAgentIds` 全选（默认全选可启动项）。
    expect(screen.getByRole('checkbox', { name: 'Claude Code' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Codex' })).toBeChecked();
  });

  it('池子里 refusal 非空的项禁用 + 理由可见（与队长选择行同一套呈现）', async () => {
    mockBackend({
      agents: [createLaunchableAgent({ agentId: 'claude-code' })],
      options: createTeamOptions({
        members: [
          createLaunchableAgent({ agentId: 'claude-code' }),
          createLaunchableAgent({ agentId: 'pi', refusal: PI_REFUSAL }),
        ],
        defaults: createTeamDefaults({ allowedAgentIds: ['claude-code', 'pi'] }),
      }),
    });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();

    const piBox = screen.getByRole('checkbox', { name: 'Pi' });
    expect(piBox).toBeDisabled();
    expect(piBox).not.toBeChecked();

    // 理由必须是可见文字（不是 title），并挂在控件上供读屏。
    const reason = screen.getByText(PI_REFUSAL);
    expect(reason).toBeVisible();
    expect(piBox).toHaveAttribute('aria-describedby', reason.id);
  });

  it('一个成员都不选：主按钮禁用 + 有说明，点击不发请求', async () => {
    mockBackend({
      agents: [
        createLaunchableAgent({ agentId: 'claude-code' }),
        createLaunchableAgent({ agentId: 'codex' }),
      ],
      options: createTeamOptions({
        members: [
          createLaunchableAgent({ agentId: 'claude-code' }),
          createLaunchableAgent({ agentId: 'codex' }),
        ],
      }),
    });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();
    await waitForConfigForm();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Claude Code' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Codex' }));

    const cta = screen.getByRole('button', { name: '以队长身份开会话' });
    expect(cta).toBeDisabled();
    expect(screen.getByText(/至少勾选一个成员/)).toBeVisible();

    fireEvent.click(cta);
    expect(startCalls()).toHaveLength(0);
  });

  it('取消勾选一个成员再提交：config 只含 allowedAgentIds，且不含被取消的那项', async () => {
    mockBackend({
      agents: [
        createLaunchableAgent({ agentId: 'claude-code' }),
        createLaunchableAgent({ agentId: 'codex' }),
      ],
      options: createTeamOptions({
        members: [
          createLaunchableAgent({ agentId: 'claude-code' }),
          createLaunchableAgent({ agentId: 'codex' }),
        ],
      }),
    });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();
    await waitForConfigForm();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Codex' }));
    fireEvent.click(screen.getByRole('button', { name: '以队长身份开会话' }));

    await waitFor(() => expect(startCalls()).toHaveLength(1));

    const payload = lastStartPayload();
    // 键集合就是判据：未改动的字段**不得**出现在 config 里（否则等于把后端默认值抄成常量）。
    expect(Object.keys(payload.config)).toEqual(['allowedAgentIds']);
    expect(payload.config.allowedAgentIds).toEqual(['claude-code']);
  });

  it('上限越界（0 / 9）：即时报错，且不调用 start_team_session', async () => {
    mockBackend({
      agents: [createLaunchableAgent({ agentId: 'claude-code' })],
    });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();
    const limit = await waitForConfigForm();

    for (const invalid of ['0', '9']) {
      fireEvent.change(limit, { target: { value: invalid } });
      expect(await screen.findByText(/上限必须在 1\.\.8 之间/)).toBeVisible();
      expect(limit).toHaveAttribute('aria-invalid', 'true');

      const cta = screen.getByRole('button', { name: '以队长身份开会话' });
      expect(cta).toBeDisabled();
      fireEvent.click(cta);
    }

    expect(startCalls()).toHaveLength(0);

    // 改回合法值 ⇒ 错误消失、按钮恢复（错误不是「一次粘住」）。
    fireEvent.change(limit, { target: { value: '3' } });
    expect(screen.queryByText(/上限必须在 1\.\.8 之间/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '以队长身份开会话' })).toBeEnabled();
  });

  it('选 bypass：主按钮上方出现一行可见的风险提示', async () => {
    mockBackend({ agents: [createLaunchableAgent({ agentId: 'claude-code' })] });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();
    await waitForConfigForm();

    expect(screen.queryByText(/成员写盘前不会有人确认/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /旁路/ }));

    const warning = screen.getByRole('note');
    expect(warning).toBeVisible();
    expect(warning).toHaveTextContent(/成员写盘前不会有人确认/);

    // 风险提示只是呈现；选择本身要真的进载荷。
    fireEvent.click(screen.getByRole('button', { name: '以队长身份开会话' }));
    await waitFor(() => expect(startCalls()).toHaveLength(1));
    expect(lastStartPayload().config).toEqual({ defaultApprovalPolicy: 'bypass' });
  });

  it('team_options 失败：配置区显示错误 + 重试入口，主按钮不可用；重试成功后恢复', async () => {
    let optionsFail = true;
    const options = createTeamOptions({
      members: [createLaunchableAgent({ agentId: 'claude-code' })],
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_launchable_agents')
        return [createLaunchableAgent({ agentId: 'claude-code' })];
      if (cmd === 'team_options') {
        if (optionsFail) throw MANAGER_DOWN;
        return options;
      }
      if (cmd === 'team_snapshot') return createTeamSnapshot();
      return createTeamSession();
    });

    render(<TeamLaunchPanel />);
    await waitForPanelReady();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(MANAGER_DOWN);
    expect(screen.getByText(/拿不到团队配置的默认值/)).toBeVisible();

    const cta = screen.getByRole('button', { name: '以队长身份开会话' });
    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    expect(startCalls()).toHaveLength(0);

    // 重试：缺省值到手后表单才出现，主按钮才可能可用。
    optionsFail = false;
    fireEvent.click(screen.getByRole('button', { name: '重新读取团队配置' }));

    expect(await screen.findByRole('spinbutton', { name: /成员上限/ })).toHaveValue(4);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '以队长身份开会话' })).toBeEnabled(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
