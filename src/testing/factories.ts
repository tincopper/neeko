import type { StackFrameDto } from '@/features/runner/types';
import type {
  Project,
  AgentConfig,
  DirTreeResult,
  FileChange,
  FileNode,
  ManagedSkillDto,
  LaunchableAgent,
  MemberStatusView,
  TagGroup,
  TaskCard,
  TaskDetail,
  Team,
  TeamDefaults,
  TeamOptions,
  TeamSession,
  TeamSnapshot,
  DiscoveredSkillDto,
} from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

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

/** 花名册一行夹具（团队面板的六态 + 取证维度）。 */
export function createMemberStatus(
  overrides: Partial<MemberStatusView> & Pick<MemberStatusView, 'memberId'>,
): MemberStatusView {
  return {
    name: overrides.memberId,
    role: 'worker',
    state: 'idle',
    verification: 'verified',
    leaseRemainingSecs: null,
    ...overrides,
  };
}

/** 任务板一行夹具（**没有 body** —— 列载荷里本来就没有这个字段）。 */
export function createTaskCard(overrides: Partial<TaskCard> & Pick<TaskCard, 'id'>): TaskCard {
  return {
    title: `task ${overrides.id}`,
    state: 'pending',
    owner: null,
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

/** 任务详情夹具（列视图 + 派活正文）。 */
export function createTaskDetail(
  overrides: Partial<TaskDetail> & Pick<TaskDetail, 'id'>,
): TaskDetail {
  return { ...createTaskCard(overrides), body: '派活正文', ...overrides };
}

/** 团队行夹具。 */
export function createTeam(overrides?: Partial<Team>): Team {
  // 显式标注 `Team`：`{...base, ...Partial<Team>}` 的推断会把可选字段漏成 `undefined`，
  // 配置列一多就会在返回值上炸类型。
  const base: Team = {
    id: 'tm_1',
    name: 'refactor',
    leadSessionId: 'sess-lead',
    leadAgentId: 'claude-code',
    projectPath: '/repo/main',
    createdAt: 1_700_000_000_000,
    closedAt: null,
    state: 'active',
    // 配置列（建队时的 `TeamConfig` 写入，之后由 `team_options` 读回）。
    allowedAgentIds: [],
    defaultModel: null,
    defaultWorkspace: 'shared',
    defaultApprovalPolicy: 'queue',
    maxMembers: 4,
  };
  return { ...base, ...overrides };
}

/** 面板快照夹具（`team_snapshot` 的完整载荷）。 */
export function createTeamSnapshot(overrides?: Partial<TeamSnapshot>): TeamSnapshot {
  return {
    team: createTeam(),
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
