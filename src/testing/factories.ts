import type { StackFrameDto } from '@/features/runner/types';
import type {
  Project,
  AgentConfig,
  ClosedReply,
  DirTreeResult,
  FileChange,
  FileNode,
  ManagedSkillDto,
  LaunchableAgent,
  MemberDetail,
  MemberEventView,
  MemberStatusView,
  TagGroup,
  TaskCard,
  TaskDetail,
  Team,
  TeamDefaults,
  TeamList,
  TeamOptions,
  TeamSession,
  TeamSnapshot,
  TeamSummary,
  DiscoveredSkillDto,
} from '@/shared/types';
import type { SessionView } from '@/shared/types/liveSessions';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

export function createProject(overrides?: Partial<Project>): Project {
  return {
    // 测试夹具铸造点（品牌唯一铸造在 api wrapper；测试/夹具是允许来源之一）
    id: 'test-project-id' as ProjectId,
    name: 'test-project',
    path: '/tmp/test-project',
    environment: { type: 'Local' },
    git_info: null,
    terminal: {
      id: 'terminal-1',
      pid: null,
      status: 'Idle',
      history: [],
      agent: null,
    },
    selected_agents: [],
    selected_ide: null,
    active_view: 'Terminal',
    collapsed: true,
    ...overrides,
  };
}

export function createAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    env: {},
    icon: null,
    enabled: true,
    ...overrides,
  };
}

export function createManagedSkill(overrides?: Partial<ManagedSkillDto>): ManagedSkillDto {
  return {
    id: 'skill-1',
    name: 'Test Skill',
    description: 'A test skill',
    source_type: 'local',
    source_ref: null,
    source_ref_resolved: null,
    source_subpath: null,
    source_branch: null,
    source_revision: null,
    remote_revision: null,
    central_path: '/path/to/skill',
    enabled: true,
    status: 'active',
    update_status: 'up_to_date',
    tags: ['test'],
    last_checked_at: null,
    created_at: 1000000,
    updated_at: 1000000,
    ...overrides,
  };
}

export function createTagGroup(overrides?: Partial<TagGroup>): TagGroup {
  return {
    id: 'tg-1',
    name: 'Test Group',
    description: null,
    icon: null,
    sort_order: 0,
    skill_count: 3,
    ...overrides,
  };
}

export function createDiscoveredSkill(overrides?: Partial<DiscoveredSkillDto>): DiscoveredSkillDto {
  return {
    id: 'discovered-1',
    tool: 'claude',
    found_path: '/path/to/discovered',
    name_guess: 'discovered-skill',
    ...overrides,
  };
}

/**
 * 一条 live session 夹具（`SessionView`）。
 *
 * 默认是**用户自己的、已被侧栏列出的**会话（有真标题 + 用户发过输入）：绝大多数派生层用例
 * 关心的是「这条会话出现在列表里」，而「不该出现」必须显式覆盖一个判据（`attribution` /
 * `hasUserInput` / `titleSource`）—— 否则「忘了设」会变成「以为测了过滤、其实测的是直通」。
 *
 * `workspaceKey` 只能来自 `WorkspaceSession.key()`（红线 12：禁止拼分隔符），默认值是
 * 主 checkout 的铸造结果；工作树单元要在用例里显式传 `WorkspaceSession.of(id, path).key`。
 */
export function createSessionView(
  overrides: Partial<SessionView> & Pick<SessionView, 'sessionId'>,
): SessionView {
  const base: Omit<SessionView, 'sessionId'> = {
    kind: 'terminal',
    attribution: { kind: 'user' },
    agentId: null,
    workspaceKey: WorkspaceSession.of('p1', null).key,
    title: 'fix the parser',
    titleSource: 'prompt',
    state: 'running',
    startedAt: '2026-10-31T10:00:00.000Z',
    updatedAt: '2026-10-31T10:00:00.000Z',
    turnCount: 1,
    hasUserInput: true,
  };
  return { ...base, ...overrides };
}

/** 变更行夹具（`path` 必填，其余取中性默认；git 状态过滤测试与列表渲染共用）。 */
export function createFileChange(
  overrides: Partial<FileChange> & Pick<FileChange, 'path'>,
): FileChange {
  return { status: 'Modified', additions: 0, deletions: 0, ...overrides };
}

/**
 * DAP 栈帧夹具（停点链：`pickStopFrame` / `buildStopLocation` / 跟随链）。
 *
 * 字面量集中在此，避免各测试各写一份「默认行 1、列 1、无源码」的帧（4 处重复，
 * 其中两份逐字相同）。调用方按需覆盖 `sourcePath` / `sourceReference` 等字段。
 */
export function createStackFrame(
  overrides: Partial<StackFrameDto> & Pick<StackFrameDto, 'id' | 'name'>,
): StackFrameDto {
  return { line: 1, column: 1, sourcePath: null, ...overrides };
}

/**
 * 目录节点夹具（文件树测试共用）。
 *
 * 文件树的目录/文件节点在多个测试文件里各有手写版本（`dirNode` / `fileNode`），
 * 形态必须与后端 `FileNode` 一致（`children` 恒存在，目录才可递归）。收敛到此处
 * 避免每处各写一份后与契约漂移。
 */
export function createDirNode(name: string, path: string, children: FileNode[] = []): FileNode {
  return { name, path, is_dir: true, children };
}

/** 文件节点夹具（`children` 恒为空数组，与后端契约一致）。 */
export function createFileNode(name: string, path: string): FileNode {
  return { name, path, is_dir: false, children: [] };
}

/** 目录读取结果夹具：默认不截断，`truncated` 用例单独传入。 */
export function createDirTreeResult(nodes: FileNode[], truncated = false): DirTreeResult {
  return { nodes, truncated };
}

/** 花名册一行夹具（团队面板的六态 + 取证维度 + 成员能干的那些事）。 */
export function createMemberStatus(
  overrides: Partial<MemberStatusView> & Pick<MemberStatusView, 'memberId'>,
): MemberStatusView {
  // 「可恢复」的默认值从**原生会话 id** 派生（`true` ⇔ 有 id）：与后端 `view.rs` 的推导同方向
  // ——后端还多一个「该 CLI 有没有续接形态」的条件，而夹具不建模逐 CLI 的形态表。所以
  // 「有 id 但不可恢复」（qoder / gemini）的用例必须显式传 `resumable: false`，否则它测到的
  // 会是「恢复会话」而不是「查看记录」。
  // 先算（不在展开之后再覆盖）：`...overrides` 里的 `agentSessionId` 必须参与这个推导。
  const agentSessionId = overrides.agentSessionId ?? null;
  // `resumable ⇒ agentSessionId 非空` 是后端不变量：只传 `{ resumable: true }` 会组合出
  // 后端不可能发出的形状，所以这里在展开之后**再**归一一次（显式 false 保留）。
  const resumable = overrides.resumable ?? agentSessionId !== null;
  return {
    name: overrides.memberId,
    role: 'worker',
    state: 'idle',
    verification: 'verified',
    leaseRemainingSecs: null,
    // 默认值选「有活会话的 CLI 成员」：绝大多数用例关心的是「能打开它」那条路径，
    // 「没有进程」必须在用例里**显式**传 `session: { live: false, terminalId: null }` ——
    // 否则「忘了设」会变成「以为测了置灰路径、其实测的是可点路径」。
    agentId: 'pi',
    session: { live: true, terminalId: 'term-w1' },
    sealed: false,
    workspace: 'shared',
    persona: null,
    agentSessionId,
    channel: 'pty',
    tier: 'a',
    ...overrides,
    // 放在 `...overrides` 之后：没有原生 id 的成员不可能「可恢复」。
    resumable: resumable && agentSessionId !== null,
  };
}

/**
 * 任务板一行夹具（**没有 body** —— 列载荷里本来就没有这个字段）。
 *
 * `teamId` 有缺省值（`tm_1`）而不是必填：任务 id 只在队内唯一，所以「某张卡片属于哪个队」
 * 必须能表达；但绝大多数用例不关心多队，缺省让它们不必每次都写一遍。
 */
export function createTaskCard(overrides: Partial<TaskCard> & Pick<TaskCard, 'id'>): TaskCard {
  return {
    teamId: 'tm_1',
    title: `task ${overrides.id}`,
    state: 'pending',
    owner: null,
    // 计划事实（谁该做）：缺省 = 未指派，需要它的用例显式传。
    assignee: null,
    workspace: 'shared',
    dependsOn: [],
    claimedAt: null,
    leaseTtl: 1800,
    summary: null,
    summaryTruncated: false,
    artifacts: [],
    reclaimCount: 0,
    ...overrides,
  };
}

/**
 * 任务详情夹具（列视图 + 派活正文）。
 *
 * 字段名必须与 `view.rs::TaskDetail` 的 serde 输出一致（`events` / `eventsTruncated`）。
 * 但**别拿它当跨栈契约的锤子** —— 夹具是照 TS 类型手写的，类型错时它跟着错。
 * 验证「后端真的发这个形状」的是 `TeamTaskCenterView.test.tsx` 里的手写电线载荷。
 */
export function createTaskDetail(
  overrides: Partial<TaskDetail> & Pick<TaskDetail, 'id'>,
): TaskDetail {
  return {
    ...createTaskCard(overrides),
    body: '派活正文',
    events: [],
    eventsTruncated: false,
    ...overrides,
  };
}

/** 团队行夹具。 */
export function createTeam(overrides?: Partial<Team>): Team {
  // 显式标注 `Team`：`{...base, ...Partial<Team>}` 的推断会把可选字段漏成 `undefined`，
  // 配置列一多就会在返回值上炸类型。
  const base: Team = {
    id: 'tm_1',
    name: 'refactor',
    leadAgentId: 'claude-code',
    projectPath: '/repo/main',
    // 与 `projectPath` 是两个事实（见 `shared/types/team.ts::Team.projectId`）：缺省的
    // 项目 id 与缺省路径属于同一个项目，需要测「切了项目仍然按团队自己的项目落键」的
    // 用例必须显式把两者叉开。
    projectId: 'p1' as ProjectId,
    createdAt: 1_700_000_000_000,
    sealedAt: null,
    state: 'open',
    // 配置列（建队时的 `TeamConfig` 写入，之后由 `team_options` 读回）。
    allowedAgentIds: [],
    defaultModel: null,
    defaultWorkspace: 'shared',
    defaultApprovalPolicy: 'queue',
    maxMembers: 4,
    // 工作区身份的另一半（缺省 = 主 checkout，不是「未知」）。
    workspaceWorktree: null,
  };
  return { ...base, ...overrides };
}

/** 面板快照夹具（`team_snapshot` 的完整载荷）。 */
export function createTeamSnapshot(overrides?: Partial<TeamSnapshot>): TeamSnapshot {
  return {
    team: createTeam(),
    // 与后端 `TeamManager::member_count` 同口径（默认快照只有队长 ⇒ 0 个成员）。
    memberCount: 0,
    members: [createMemberStatus({ memberId: 'lead@tm_1', name: 'lead', role: 'lead' })],
    tasks: [],
    tasksTruncated: false,
    ...overrides,
  };
}

/** `start_team_session` 的返回夹具。 */
export function createTeamSession(overrides?: Partial<TeamSession>): TeamSession {
  return {
    teamId: 'tm_1',
    memberId: 'lead@tm_1',
    terminalId: 'sess-lead',
    endpointUrl: 'http://127.0.0.1:0/mcp',
    leadAgentId: 'claude-code',
    ...overrides,
  };
}

/** 一条审计记录的成员视图夹具。 */
export function createMemberEvent(overrides?: Partial<MemberEventView>): MemberEventView {
  return {
    at: 1_700_000_000_000,
    kind: 'claim',
    actor: 'w1@tm_1',
    subject: 't1',
    detail: null,
    ...overrides,
  };
}

/**
 * 成员详情夹具（`team_member_detail` 的完整载荷）。
 *
 * 默认值选的是**“什么都没有”的合法形态**（空任务 / 空事件）：需要某个块出现的用例
 * 必须**显式**传进来 —— 否则“忘了设”会变成“以为测了待批块、其实测的是空数组”。
 */
export function createMemberDetail(overrides?: Partial<MemberDetail>): MemberDetail {
  return {
    member: createMemberStatus({ memberId: 'w1@tm_1', name: 'frontend' }),
    tasks: [],
    tasksTruncated: false,
    awaitingApproval: [],
    events: [],
    eventsTruncated: false,
    ...overrides,
  };
}

/**
 * `team_launchable_agents` 的一行夹具（默认**可启动**）。
 *
 * 默认 `refusal: null` 是有意为之：绝大多数用例关心的是「可启动」那条路径，
 * 被拒的行必须在用例里**显式**写出来 —— 这样「忘了设 refusal」不会变成
 * 「以为测了拒绝路径、其实测的是正常路径」。
 */
export function createLaunchableAgent(
  overrides: Partial<LaunchableAgent> & Pick<LaunchableAgent, 'agentId'>,
): LaunchableAgent {
  return { refusal: null, ...overrides };
}

/**
 * `team_options.defaults` 夹具（`TeamDefaults` 的解析后形态）。
 *
 * 每个字段都取后端的**真实缺省**（`TeamConfig::default`：`4` / `shared` / `queue` /
 * 无模型），不是为了少写字：面板的默认值本来就该来自这里，写别的值反而会掩盖
 * 「面板其实在用自己的常量」这类缺陷。用例要测「默认值真的来自后端」时，把它改成一个
 * **不可能出现在前端**的值（如 `7`）。
 */
export function createTeamDefaults(overrides?: Partial<TeamDefaults>): TeamDefaults {
  const base: TeamDefaults = {
    allowedAgentIds: [],
    defaultModel: null,
    defaultWorkspace: 'shared',
    defaultApprovalPolicy: 'queue',
    defaultPersona: null,
    maxMembers: 4,
    memberCount: 0,
  };
  return { ...base, ...overrides };
}

/**
 * `team_options` 的载荷夹具。
 *
 * `members` 与 `defaults.allowedAgentIds` 在 Rust 侧**恒等**（后者是前者的 id 投影，见
 * `options.rs::resolve`），所以默认值从 `members` 派生 —— 用例只改一处就不会造出
 * 一个后端永远不会返回的载荷。
 */
export function createTeamOptions(overrides?: Partial<TeamOptions>): TeamOptions {
  const members = overrides?.members ?? [
    createLaunchableAgent({ agentId: 'claude-code' }),
    createLaunchableAgent({ agentId: 'codex' }),
  ];
  const defaults =
    overrides?.defaults ??
    createTeamDefaults({ allowedAgentIds: members.map((row) => row.agentId) });
  return { members, defaults };
}

/**
 * `team_list` 的一行夹具（`TeamSummary`）。
 *
 * 默认 `state: 'active'`：三种状态里只有它是「真的能继续干活」，其余两态必须在用例里
 * **显式**写出来 —— 这样「忘了设状态」不会变成「以为测了 closing、其实测的是 active」。
 */
export function createTeamSummary(
  overrides: Partial<TeamSummary> & Pick<TeamSummary, 'teamId'>,
): TeamSummary {
  return {
    name: 'refactor',
    state: 'open',
    projectPath: '/repo/main',
    // 单元身份的两分量：主 checkout（`workspaceWorktree: null`）+ 一个项目 id。
    projectId: 'p1',
    workspaceWorktree: null,
    leadAgentId: 'claude-code',
    // 夹具团队有队长行（`{name}@{team}` 形态，同 Rust 侧 `fixture_member`）。
    leadMemberId: 'lead@tm_1',
    createdAt: 1_700_000_000_000,
    sealedAt: null,
    memberCount: 2,
    taskTotal: 5,
    taskOpen: 2,
    taskDone: 3,
    ...overrides,
  };
}

/** `team_list` 的载荷夹具。 */
export function createTeamList(overrides?: Partial<TeamList>): TeamList {
  return {
    teams: [createTeamSummary({ teamId: 'tm_1' })],
    truncated: false,
    ...overrides,
  };
}

/** `team_close` 的成功返回夹具（`ClosedReply`）。 */
export function createClosedReply(overrides?: Partial<ClosedReply>): ClosedReply {
  return {
    teamId: 'tm_1',
    memberId: null,
    membersClosed: ['w1@tm_1'],
    // 成功路径恒空（Rust 是 `Vec<(String, String)>` ⇒ 二元数组，不是对象）。
    membersFailed: [],
    teamState: 'sealed',
    notes: [],
    ...overrides,
  };
}
