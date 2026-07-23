import { open } from '@tauri-apps/plugin-dialog';
import { create } from 'zustand';

import type {
  ManagedSkillDto,
  TagGroup,
  DiscoveredSkillDto,
  SkillView,
  AgentSkillGroup,
} from '@/shared/types';

import { writeFileContent as writeFileContentApi } from '../file/api/fileApi';

import {
  getManagedSkills,
  deleteManagedSkill,
  getSkillDocument as getSkillDocumentApi,
  refreshSkillMetadata as refreshSkillMetadataApi,
  clearAllManagedSkills as clearAllManagedSkillsApi,
  getTagGroups as getTagGroupsApi,
  createTagGroup as createTagGroupApi,
  deleteTagGroup as deleteTagGroupApi,
  installLocalSkill as installLocalSkillApi,
  scanLocalSkills as scanLocalSkillsApi,
  createSkill as createSkillApi,
  importDiscoveredSkill as importDiscoveredSkillApi,
  getSkillsForTagGroup as getSkillsForTagGroupApi,
  addSkillToTagGroup as addSkillToTagGroupApi,
  removeSkillFromTagGroup as removeSkillFromTagGroupApi,
  syncTagGroup as syncTagGroupApi,
  updateTagGroup as updateTagGroupApi,
  getProjectTagGroups as getProjectTagGroupsApi,
  setProjectTagGroups as setProjectTagGroupsApi,
  applyProjectSkills as applyProjectSkillsApi,
  getAllProjectSkillCounts as getAllProjectSkillCountsApi,
  getAllProjectTagGroupCounts as getAllProjectTagGroupCountsApi,
  getAgentSkills as getAgentSkillsApi,
  checkSkillUpdate as checkSkillUpdateApi,
  updateSkill as updateSkillApi,
  setManagedSkillEnabled as setManagedSkillEnabledApi,
} from './api/skillApi';

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** skill 文档文件名，与 Rust get_skill_document 查找顺序首位一致 */
const SKILL_DOC_FILENAME = 'SKILL.md';

// ─── State ──────────────────────────────────────────────────────────────────

interface SkillStoreState {
  skills: ManagedSkillDto[];
  tagGroups: TagGroup[];
  loading: boolean;
  activeSkillView: SkillView;
  searchQuery: string;
  selectedSkillId: string | null;
  activeTagGroupId: string | null;
  /** Tag groups bound to the current project (Project Skills view). */
  projectTagGroups: TagGroup[];
  projectBindingsLoading: boolean;
  /** Last project id we auto-applied skills for (dedupe). */
  lastAppliedProjectId: string | null;
  applyingProjectId: string | null;
  /** Project-local skill counts keyed by project id. */
  projectSkillCounts: Map<string, number>;
  projectSkillCountsLoading: boolean;
  projectSkillCountsError: string | null;
  /** Bound tag-group counts keyed by project id (missing => 0). */
  projectTagGroupCounts: Map<string, number>;
  projectTagGroupCountsLoading: boolean;
  projectTagGroupCountsError: string | null;
  /** Per-agent disk skill groups (left rail counts + Agents view source). */
  agentSkillGroups: AgentSkillGroup[];
  agentSkillGroupsLoading: boolean;
  /** Filter by source type. */
  sourceFilter: 'all' | 'local' | 'git' | 'skillssh';
  /** Filter by tag names (AND logic, empty = no filter). */
  tagFilter: string[];
  /** Active agent detail view. */
  activeAgentId: string | null;
}

// ─── Actions ────────────────────────────────────────────────────────────────

interface SkillStoreActions {
  // 数据动作
  refreshSkills: () => Promise<void>;
  /** Re-parse descriptions from disk; then reload list. */
  refreshMetadata: () => Promise<number>;
  /** Clear all managed skills (DB + central files). */
  clearAllSkills: () => Promise<number>;
  deleteSkill: (id: string) => Promise<void>;
  getSkillDocument: (skillId: string) => Promise<string>;
  /** Refresh left-rail agent skill counts (disk scan). */
  refreshAgentSkills: () => Promise<void>;
  /**
   * Refresh all left-rail numeric badges after mutations:
   * Library length (via skills), tag skill_count, agent counts, project disk counts.
   */
  refreshRailCounts: () => Promise<void>;

  // TagGroup 动作
  refreshTagGroups: () => Promise<void>;
  createTagGroup: (name: string, description?: string, icon?: string) => Promise<void>;
  deleteTagGroup: (id: string) => Promise<void>;
  updateTagGroup: (id: string, name: string) => Promise<void>;
  addSkillToTagGroup: (tagGroupId: string, skillId: string) => Promise<void>;
  removeSkillFromTagGroup: (tagGroupId: string, skillId: string) => Promise<void>;
  syncTagGroup: (tagGroupId: string) => Promise<void>;

  // Project bindings
  loadProjectTagGroups: (projectId: string) => Promise<void>;
  setProjectTagGroups: (projectId: string, tagGroupIds: string[], projectPath?: string) => Promise<void>;
  applyProjectSkills: (projectId: string) => Promise<void>;
  /** Auto apply on project switch — install only, no remove; deduped. */
  applyProjectSkillsOnSelect: (projectId: string | null) => Promise<void>;
  refreshProjectSkillCounts: () => Promise<void>;
  /** Bulk refresh bound tag-group counts for all projects. */
  refreshProjectTagGroupCounts: () => Promise<void>;

  // Install 动作
  installLocal: () => Promise<void>;
  scanSkills: () => Promise<DiscoveredSkillDto[]>;
  createSkill: (name: string, content: string) => Promise<void>;
  importDiscoveredSkill: (discoveredPath: string, name?: string) => Promise<void>;
  checkSkillUpdate: (
    skillId: string,
  ) => Promise<{ status: string; remote_revision: string | null }>;
  updateSkillFromSource: (skillId: string) => Promise<void>;
  /** Library-level enable gate for future sync/deploy (does not remove installs). */
  setSkillEnabled: (skillId: string, enabled: boolean) => Promise<void>;

  // 文档编辑
  updateSkillDocument: (skillId: string, name: string, content: string) => Promise<void>;

  // Tag Group 过滤
  fetchSkillsForTagGroup: (tagGroupId: string) => Promise<ManagedSkillDto[]>;

  // UI 动作
  setActiveSkillView: (view: SkillView) => void;
  setSearchQuery: (q: string) => void;
  setSelectedSkillId: (id: string | null) => void;
  setActiveTagGroupId: (id: string | null) => void;
  setActiveAgentId: (id: string | null) => void;
  setSourceFilter: (source: 'all' | 'local' | 'git' | 'skillssh') => void;
  setTagFilter: (tags: string[]) => void;
  toggleTagFilter: (tag: string) => void;
  /** Patch description after SKILL.md lazy parse (keeps list in sync). */
  patchSkillDescription: (skillId: string, description: string) => void;
}

// ─── 初始状态（导出供测试重置使用）────────────────────────────────────────

export const initialSkillState: SkillStoreState = {
  skills: [],
  tagGroups: [],
  loading: true,
  activeSkillView: 'local',
  searchQuery: '',
  selectedSkillId: null,
  activeTagGroupId: null,
  projectTagGroups: [],
  projectBindingsLoading: false,
  lastAppliedProjectId: null,
  applyingProjectId: null,
  projectSkillCounts: new Map(),
  projectSkillCountsLoading: false,
  projectSkillCountsError: null,
  projectTagGroupCounts: new Map(),
  projectTagGroupCountsLoading: false,
  projectTagGroupCountsError: null,
  agentSkillGroups: [],
  agentSkillGroupsLoading: false,
  sourceFilter: 'all',
  tagFilter: [],
  activeAgentId: null,
};

// ─── Store ──────────────────────────────────────────────────────────────────

export const useSkillStore = create<SkillStoreState & SkillStoreActions>()((set, get) => ({
  ...initialSkillState,

  // ── 数据动作 ──

  refreshSkills: async () => {
    try {
      const skills = await getManagedSkills();
      set({ skills, loading: false });
    } catch (e) {
      console.error('[skillStore] refreshSkills failed:', e);
      set({ loading: false });
      throw e;
    }
  },

  refreshMetadata: async () => {
    const n = await refreshSkillMetadataApi();
    await get().refreshSkills();
    return n;
  },

  clearAllSkills: async () => {
    const n = await clearAllManagedSkillsApi();
    set({ skills: [], loading: false });
    return n;
  },

  deleteSkill: async (id: string) => {
    await deleteManagedSkill(id);
    set((state) => ({ skills: state.skills.filter((s) => s.id !== id) }));
    // Tag membership + agent/project disk counts may change when a library skill is removed.
    void get()
      .refreshRailCounts()
      .catch((e) => console.error('[skillStore] refreshRailCounts after deleteSkill:', e));
  },

  getSkillDocument: async (skillId: string): Promise<string> => {
    const result = await getSkillDocumentApi(skillId);
    return result.content;
  },

  refreshAgentSkills: async () => {
    set({ agentSkillGroupsLoading: true });
    try {
      const agentSkillGroups = await getAgentSkillsApi();
      set({ agentSkillGroups, agentSkillGroupsLoading: false });
    } catch (e) {
      console.error('[skillStore] refreshAgentSkills failed:', e);
      set({ agentSkillGroupsLoading: false });
      throw e;
    }
  },

  refreshRailCounts: async () => {
    const tasks = [
      get()
        .refreshTagGroups()
        .catch((e) => {
          console.error('[skillStore] refreshTagGroups in refreshRailCounts:', e);
        }),
      get()
        .refreshAgentSkills()
        .catch((e) => {
          console.error('[skillStore] refreshAgentSkills in refreshRailCounts:', e);
        }),
      get()
        .refreshProjectSkillCounts()
        .catch((e) => {
          console.error('[skillStore] refreshProjectSkillCounts in refreshRailCounts:', e);
        }),
      get()
        .refreshProjectTagGroupCounts()
        .catch((e) => {
          console.error('[skillStore] refreshProjectTagGroupCounts in refreshRailCounts:', e);
        }),
    ];
    await Promise.all(tasks);
  },

  // ── TagGroup 动作 ──

  refreshTagGroups: async () => {
    try {
      const tagGroups = await getTagGroupsApi();
      set({ tagGroups });
    } catch (e) {
      console.error('[skillStore] refreshTagGroups failed:', e);
      throw e;
    }
  },

  createTagGroup: async (name: string, description?: string, icon?: string) => {
    const group = await createTagGroupApi(name, description, icon);
    set((state) => ({ tagGroups: [...state.tagGroups, group] }));
  },

  deleteTagGroup: async (id: string) => {
    await deleteTagGroupApi(id);
    // Cascade delete on DB also drops project_tag_groups rows.
    set((state) => ({
      tagGroups: state.tagGroups.filter((g) => g.id !== id),
      activeTagGroupId: state.activeTagGroupId === id ? null : state.activeTagGroupId,
      projectTagGroups: state.projectTagGroups.filter((g) => g.id !== id),
    }));
    void get()
      .refreshProjectTagGroupCounts()
      .catch((e) => console.error('[skillStore] refresh counts after deleteTagGroup:', e));
  },

  updateTagGroup: async (id: string, name: string) => {
    await updateTagGroupApi(id, name);
    set((state) => ({
      tagGroups: state.tagGroups.map((g) => (g.id === id ? { ...g, name } : g)),
      projectTagGroups: state.projectTagGroups.map((g) => (g.id === id ? { ...g, name } : g)),
    }));
  },

  addSkillToTagGroup: async (tagGroupId: string, skillId: string) => {
    await addSkillToTagGroupApi(tagGroupId, skillId);
    await get().refreshTagGroups();
  },

  removeSkillFromTagGroup: async (tagGroupId: string, skillId: string) => {
    await removeSkillFromTagGroupApi(tagGroupId, skillId);
    await get().refreshTagGroups();
  },

  syncTagGroup: async (tagGroupId: string) => {
    await syncTagGroupApi(tagGroupId);
    // Global agent dirs may change — refresh left-rail agent counts.
    void get()
      .refreshAgentSkills()
      .catch((e) => console.error('[skillStore] refreshAgentSkills after syncTagGroup:', e));
  },

  // ── Project bindings ──

  loadProjectTagGroups: async (projectId: string) => {
    set({ projectBindingsLoading: true });
    try {
      const projectTagGroups = await getProjectTagGroupsApi(projectId);
      set({ projectTagGroups, projectBindingsLoading: false });
    } catch (e) {
      console.error('[skillStore] loadProjectTagGroups failed:', e);
      set({ projectTagGroups: [], projectBindingsLoading: false });
      throw e;
    }
  },

  setProjectTagGroups: async (projectId: string, tagGroupIds: string[], projectPath?: string) => {
    await setProjectTagGroupsApi(projectId, tagGroupIds, projectPath);
    await get().loadProjectTagGroups(projectId);
    set((state) => {
      const next = new Map(state.projectTagGroupCounts);
      next.set(projectId, tagGroupIds.length);
      return { projectTagGroupCounts: next };
    });
    void get()
      .refreshProjectSkillCounts()
      .catch((e) =>
        console.error('[skillStore] refreshProjectSkillCounts after setProjectTagGroups:', e),
      );
  },

  applyProjectSkills: async (projectId: string) => {
    set({ applyingProjectId: projectId });
    try {
      await applyProjectSkillsApi(projectId);
      set({ lastAppliedProjectId: projectId, applyingProjectId: null });
    } catch (e) {
      set({ applyingProjectId: null });
      throw e;
    }
  },

  applyProjectSkillsOnSelect: async (projectId: string | null) => {
    if (!projectId) return;
    const { lastAppliedProjectId, applyingProjectId } = get();
    if (applyingProjectId === projectId || lastAppliedProjectId === projectId) {
      return;
    }
    try {
      await get().applyProjectSkills(projectId);
    } catch (e) {
      // Non-blocking for project switch — log only; UI can toast if needed
      console.error('[skillStore] applyProjectSkillsOnSelect failed:', e);
    }
  },

  refreshProjectSkillCounts: async () => {
    set({ projectSkillCountsLoading: true, projectSkillCountsError: null });
    try {
      const counts = await getAllProjectSkillCountsApi();
      const map = new Map<string, number>();
      for (const c of counts) {
        map.set(c.project_id, c.total_count);
      }
      set({
        projectSkillCounts: map,
        projectSkillCountsLoading: false,
        projectSkillCountsError: null,
      });
    } catch (e) {
      const message = String(e);
      console.error('[skillStore] refreshProjectSkillCounts failed:', e);
      set({ projectSkillCountsLoading: false, projectSkillCountsError: message });
      throw e;
    }
  },

  refreshProjectTagGroupCounts: async () => {
    set({ projectTagGroupCountsLoading: true, projectTagGroupCountsError: null });
    try {
      const counts = await getAllProjectTagGroupCountsApi();
      const map = new Map<string, number>();
      for (const c of counts) {
        map.set(c.project_id, c.group_count);
      }
      set({
        projectTagGroupCounts: map,
        projectTagGroupCountsLoading: false,
        projectTagGroupCountsError: null,
      });
    } catch (e) {
      const message = String(e);
      console.error('[skillStore] refreshProjectTagGroupCounts failed:', e);
      set({
        projectTagGroupCountsLoading: false,
        projectTagGroupCountsError: message,
      });
      throw e;
    }
  },

  // ── Install 动作 ──

  installLocal: async () => {
    // Skill packages are directories (SKILL.md + assets). Backend also accepts .md / zip.
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select skill directory',
    });
    if (!selected) return;
    await installLocalSkillApi(selected as string);
    await get().refreshSkills();
    // Library badge uses skills.length; tags/agents unchanged but keep rail consistent.
    void get()
      .refreshRailCounts()
      .catch((e) => console.error('[skillStore] refreshRailCounts after installLocal:', e));
  },

  scanSkills: async (): Promise<DiscoveredSkillDto[]> => {
    return await scanLocalSkillsApi();
  },

  createSkill: async (name: string, content: string) => {
    await createSkillApi(name, content);
    await get().refreshSkills();
  },

  importDiscoveredSkill: async (discoveredPath: string, name?: string) => {
    await importDiscoveredSkillApi(discoveredPath, name);
    await get().refreshSkills();
    void get()
      .refreshRailCounts()
      .catch((e) =>
        console.error('[skillStore] refreshRailCounts after importDiscoveredSkill:', e),
      );
  },

  checkSkillUpdate: async (skillId: string) => {
    const result = await checkSkillUpdateApi(skillId);
    set((state) => ({
      skills: state.skills.map((s) =>
        s.id === skillId ? { ...s, update_status: result.status } : s,
      ),
    }));
    return result;
  },

  updateSkillFromSource: async (skillId: string) => {
    const updated = await updateSkillApi(skillId);
    set((state) => ({
      skills: state.skills.map((s) => (s.id === skillId ? { ...s, ...updated } : s)),
    }));
  },

  setSkillEnabled: async (skillId: string, enabled: boolean) => {
    const updated = await setManagedSkillEnabledApi(skillId, enabled);
    set((state) => ({
      skills: state.skills.map((s) => (s.id === skillId ? { ...s, ...updated } : s)),
    }));
    // Tag-group skill_count only includes enabled skills — refresh badges.
    await get().refreshTagGroups().catch((e) => {
      console.error('[skillStore] refreshTagGroups after setSkillEnabled:', e);
    });
  },

  // ── 文档编辑 ──

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateSkillDocument: async (skillId: string, _name: string, content: string) => {
    const skill = get().skills.find((s) => s.id === skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    await writeFileContentApi(skill.central_path, SKILL_DOC_FILENAME, content);
    await get().refreshSkills();
  },

  // ── Tag Group 过滤 ──

  fetchSkillsForTagGroup: async (tagGroupId: string): Promise<ManagedSkillDto[]> => {
    return await getSkillsForTagGroupApi(tagGroupId);
  },

  // ── UI 动作 ──

  setActiveSkillView: (view: SkillView) => set({ activeSkillView: view }),
  setSearchQuery: (q: string) => set({ searchQuery: q }),
  setSelectedSkillId: (id: string | null) => set({ selectedSkillId: id }),
  setActiveTagGroupId: (id: string | null) => set({ activeTagGroupId: id }),
  setActiveAgentId: (id: string | null) => set({ activeAgentId: id }),
  setSourceFilter: (source: 'all' | 'local' | 'git' | 'skillssh') => set({ sourceFilter: source }),
  setTagFilter: (tags: string[]) => set({ tagFilter: tags }),
  toggleTagFilter: (tag: string) => {
    set((state) => {
      const active = state.tagFilter.includes(tag);
      return {
        tagFilter: active ? state.tagFilter.filter((t) => t !== tag) : [...state.tagFilter, tag],
      };
    });
  },

  patchSkillDescription: (skillId, description) => {
    const desc = description.trim();
    if (!desc) return;
    set((state) => ({
      skills: state.skills.map((s) =>
        s.id === skillId && !s.description?.trim() ? { ...s, description: desc } : s,
      ),
    }));
  },
}));
