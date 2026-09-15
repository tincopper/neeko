import {
  dapDiscoverEntries,
  dapGetSession,
  dapListConfigs,
  dapSaveConfigs,
} from '../../api/debugApi';

import { notifyError } from './shared';
import type { DebugConfigSlice, DebugSliceCreator } from './types';

/**
 * 启动配置与入口点。
 *
 * 注意 `loadConfigs` 顺带做三件事：会话回填、断点加载、入口点发现 —— 这是「项目切换 / 面板首次
 * 打开」的一次性水合（hydration），刻意留在同一个动作里，避免调用方漏掉其中一步。
 */
export const createConfigSlice: DebugSliceCreator<DebugConfigSlice> = (set, get) => ({
  configs: [],
  entries: [],
  selectedConfigName: null,

  loadConfigs: async (projectId) => {
    try {
      const configs = await dapListConfigs(projectId);
      const selected =
        get().selectedConfigName && configs.some((c) => c.name === get().selectedConfigName)
          ? get().selectedConfigName
          : (configs[0]?.name ?? null);
      set({ configs, selectedConfigName: selected });
      const session = await dapGetSession(projectId);
      if (session) set({ session });
      // Load persisted breakpoints whenever configs load
      await get().loadBreakpoints(projectId);
      void get().loadEntries(projectId);
    } catch (e) {
      set({ error: String(e), configs: [] });
    }
  },

  loadEntries: async (projectId) => {
    try {
      const entries = await dapDiscoverEntries(projectId);
      set({ entries });
    } catch {
      set({ entries: [] });
    }
  },

  selectConfig: (name) => set({ selectedConfigName: name }),

  saveConfigs: async (projectId, configurations) => {
    set({ error: null });
    try {
      await dapSaveConfigs(projectId, configurations);
      set({
        configs: configurations,
        selectedConfigName:
          get().selectedConfigName &&
          configurations.some((c) => c.name === get().selectedConfigName)
            ? get().selectedConfigName
            : (configurations[0]?.name ?? null),
      });
    } catch (e) {
      const msg = String(e);
      set({ error: msg });
      notifyError(msg);
      throw e;
    }
  },

  addConfig: async (projectId, config) => {
    const existing = get().configs;
    if (existing.some((c) => c.name === config.name)) {
      const msg = `Config "${config.name}" already exists`;
      set({ error: msg });
      notifyError(msg);
      throw new Error(msg);
    }
    const next = [...existing, config];
    await get().saveConfigs(projectId, next);
    set({ selectedConfigName: config.name });
  },

  updateConfig: async (projectId, originalName, config) => {
    const existing = get().configs;
    if (config.name !== originalName && existing.some((c) => c.name === config.name)) {
      const msg = `Config "${config.name}" already exists`;
      set({ error: msg });
      notifyError(msg);
      throw new Error(msg);
    }
    const next = existing.map((c) => (c.name === originalName ? config : c));
    await get().saveConfigs(projectId, next);
    set({ selectedConfigName: config.name });
  },

  deleteConfig: async (projectId, name) => {
    const next = get().configs.filter((c) => c.name !== name);
    await get().saveConfigs(projectId, next);
  },
});
