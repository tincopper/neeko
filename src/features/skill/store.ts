import { create } from 'zustand';
import { open } from '@tauri-apps/plugin-dialog';
import {
  getManagedSkills,
  deleteManagedSkill,
  getSkillDocument as getSkillDocumentApi,
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
  getProjectTagGroups as getProjectTagGroupsApi,
  setProjectTagGroups as setProjectTagGroupsApi,
  applyProjectSkills as applyProjectSkillsApi,
  checkSkillUpdate as checkSkillUpdateApi,
  updateSkill as updateSkillApi,
} from './api/skillApi';
import { writeFileContent as writeFileContentApi } from '../file/api/fileApi';
import type {
  ManagedSkillDto,
  TagGroup,
  DiscoveredSkillDto,
  SkillView,
} from '@/shared/types';

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
}

// ─── Actions ────────────────────────────────────────────────────────────────

interface SkillStoreActions {
  // 数据动作
  refreshSkills: () => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  getSkillDocument: (skillId: string) => Promise<string>;

  // TagGroup 动作
  refreshTagGroups: () => Promise<void>;
  createTagGroup: (name: string, description?: string, icon?: string) => Promise<void>;
  deleteTagGroup: (id: string) => Promise<void>;
  addSkillToTagGroup: (tagGroupId: string, skillId: string) => Promise<void>;
  removeSkillFromTagGroup: (tagGroupId: string, skillId: string) => Promise<void>;
  syncTagGroup: (tagGroupId: string) => Promise<void>;

  // Project bindings
  loadProjectTagGroups: (projectId: string) => Promise<void>;
  setProjectTagGroups: (projectId: string, tagGroupIds: string[]) => Promise<void>;
  applyProjectSkills: (projectId: string) => Promise<void>;
  /** Auto apply on project switch — install only, no remove; deduped. */
  applyProjectSkillsOnSelect: (projectId: string | null) => Promise<void>;

  // Install 动作
  installLocal: () => Promise<void>;
  scanSkills: () => Promise<DiscoveredSkillDto[]>;
  createSkill: (name: string, content: string) => Promise<void>;
  importDiscoveredSkill: (discoveredPath: string, name?: string) => Promise<void>;
  checkSkillUpdate: (skillId: string) => Promise<{ status: string; remote_revision: string | null }>;
  updateSkillFromSource: (skillId: string) => Promise<void>;

  // 文档编辑
  updateSkillDocument: (skillId: string, name: string, content: string) => Promise<void>;

  // Tag Group 过滤
  fetchSkillsForTagGroup: (tagGroupId: string) => Promise<ManagedSkillDto[]>;

  // UI 动作
  setActiveSkillView: (view: SkillView) => void;
  setSearchQuery: (q: string) => void;
  setSelectedSkillId: (id: string | null) => void;
  setActiveTagGroupId: (id: string | null) => void;
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

  deleteSkill: async (id: string) => {
    await deleteManagedSkill(id);
    set(state => ({ skills: state.skills.filter(s => s.id !== id) }));
  },

  getSkillDocument: async (skillId: string): Promise<string> => {
    const result = await getSkillDocumentApi(skillId);
    return result.content;
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
    set(state => ({ tagGroups: [...state.tagGroups, group] }));
  },

  deleteTagGroup: async (id: string) => {
    await deleteTagGroupApi(id);
    set(state => ({
      tagGroups: state.tagGroups.filter(g => g.id !== id),
      activeTagGroupId: state.activeTagGroupId === id ? null : state.activeTagGroupId,
      projectTagGroups: state.projectTagGroups.filter(g => g.id !== id),
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

  setProjectTagGroups: async (projectId: string, tagGroupIds: string[]) => {
    await setProjectTagGroupsApi(projectId, tagGroupIds);
    const all = get().tagGroups;
    set({
      projectTagGroups: all.filter(g => tagGroupIds.includes(g.id)),
    });
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
  },

  checkSkillUpdate: async (skillId: string) => {
    const result = await checkSkillUpdateApi(skillId);
    set(state => ({
      skills: state.skills.map(s =>
        s.id === skillId ? { ...s, update_status: result.status } : s,
      ),
    }));
    return result;
  },

  updateSkillFromSource: async (skillId: string) => {
    const updated = await updateSkillApi(skillId);
    set(state => ({
      skills: state.skills.map(s => (s.id === skillId ? { ...s, ...updated } : s)),
    }));
  },

  // ── 文档编辑 ──

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateSkillDocument: async (skillId: string, _name: string, content: string) => {
    const skill = get().skills.find(s => s.id === skillId);
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
}));
