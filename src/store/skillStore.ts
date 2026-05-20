import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  ManagedSkillDto,
  TagGroup,
  DiscoveredSkillDto,
  SkillView,
} from '../types';

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

  // Install 动作
  installLocal: () => Promise<void>;
  scanSkills: () => Promise<DiscoveredSkillDto[]>;
  createSkill: (name: string, content: string) => Promise<void>;
  importDiscoveredSkill: (discoveredPath: string, name?: string) => Promise<void>;

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
};

// ─── Store ──────────────────────────────────────────────────────────────────

export const useSkillStore = create<SkillStoreState & SkillStoreActions>()((set, get) => ({
  ...initialSkillState,

  // ── 数据动作 ──

  refreshSkills: async () => {
    try {
      const skills = await invoke<ManagedSkillDto[]>('get_managed_skills');
      set({ skills, loading: false });
    } catch (e) {
      console.error('[skillStore] refreshSkills failed:', e);
      set({ loading: false });
    }
  },

  deleteSkill: async (id: string) => {
    try {
      await invoke('delete_managed_skill', { skillId: id });
      set(state => ({ skills: state.skills.filter(s => s.id !== id) }));
    } catch (e) {
      console.error('[skillStore] deleteSkill failed:', e);
    }
  },

  getSkillDocument: async (skillId: string): Promise<string> => {
    const result = await invoke<{ content: string }>('get_skill_document', { skillId });
    return result.content;
  },

  // ── TagGroup 动作 ──

  refreshTagGroups: async () => {
    try {
      const tagGroups = await invoke<TagGroup[]>('get_tag_groups');
      set({ tagGroups });
    } catch (e) {
      console.error('[skillStore] refreshTagGroups failed:', e);
    }
  },

  createTagGroup: async (name: string, description?: string, icon?: string) => {
    try {
      const group = await invoke<TagGroup>('create_tag_group', { name, description, icon });
      set(state => ({ tagGroups: [...state.tagGroups, group] }));
    } catch (e) {
      console.error('[skillStore] createTagGroup failed:', e);
    }
  },

  deleteTagGroup: async (id: string) => {
    try {
      await invoke('delete_tag_group_cmd', { id });
      set(state => ({ tagGroups: state.tagGroups.filter(g => g.id !== id) }));
    } catch (e) {
      console.error('[skillStore] deleteTagGroup failed:', e);
    }
  },

  // ── Install 动作 ──

  installLocal: async () => {
    const filePath = await open({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!filePath) return;
    try {
      await invoke('install_local_skill', { sourcePath: filePath });
      await get().refreshSkills();
    } catch (e) {
      console.error('[skillStore] installLocal failed:', e);
    }
  },

  scanSkills: async (): Promise<DiscoveredSkillDto[]> => {
    try {
      return await invoke<DiscoveredSkillDto[]>('scan_local_skills');
    } catch (e) {
      console.error('[skillStore] scanSkills failed:', e);
      return [];
    }
  },

  createSkill: async (name: string, content: string) => {
    try {
      await invoke('create_skill', { name, skillContent: content });
      await get().refreshSkills();
    } catch (e) {
      console.error('[skillStore] createSkill failed:', e);
    }
  },

  importDiscoveredSkill: async (discoveredPath: string, name?: string) => {
    try {
      await invoke('import_discovered_skill', { discoveredPath, name });
      await get().refreshSkills();
    } catch (e) {
      console.error('[skillStore] importDiscoveredSkill failed:', e);
    }
  },

  // ── 文档编辑 ──

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateSkillDocument: async (skillId: string, _name: string, content: string) => {
    const skill = get().skills.find(s => s.id === skillId);
    if (!skill) {
      console.error('[skillStore] updateSkillDocument: skill not found', skillId);
      return;
    }
    // 复用 write_file_content，通过 rootPath 指定 central_path，无需 project 上下文
    await invoke('write_file_content', {
      projectId: '',
      filePath: SKILL_DOC_FILENAME,
      content,
      rootPath: skill.central_path,
    });
    // 刷新 skills 列表以同步 metadata（description 可能从 frontmatter 更新）
    await get().refreshSkills();
  },

  // ── Tag Group 过滤 ──

  fetchSkillsForTagGroup: async (tagGroupId: string): Promise<ManagedSkillDto[]> => {
    try {
      return await invoke<ManagedSkillDto[]>('get_skills_for_tag_group_cmd', { tagGroupId });
    } catch (e) {
      console.error('[skillStore] fetchSkillsForTagGroup failed:', e);
      return [];
    }
  },

  // ── UI 动作 ──

  setActiveSkillView: (view: SkillView) => set({ activeSkillView: view }),
  setSearchQuery: (q: string) => set({ searchQuery: q }),
  setSelectedSkillId: (id: string | null) => set({ selectedSkillId: id }),
  setActiveTagGroupId: (id: string | null) => set({ activeTagGroupId: id }),
}));
