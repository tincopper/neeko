import type { Project, AgentConfig } from '@/shared/types';
import type { ManagedSkillDto, TagGroup, DiscoveredSkillDto } from '@/shared/types';

export function createProject(overrides?: Partial<Project>): Project {
  return {
    id: 'test-project-id',
    name: 'test-project',
    path: '/tmp/test-project',
    git_info: null,
    terminal: {
      id: 'terminal-1',
      pid: null,
      status: 'Idle',
      history: [],
      agent: null,
    },
    selected_agent: null,
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
    central_path: '/path/to/skill',
    enabled: true,
    status: 'active',
    update_status: 'up_to_date',
    tags: ['test'],
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
