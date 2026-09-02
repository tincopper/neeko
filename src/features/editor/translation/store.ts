import { create } from 'zustand';

import type { SourceBlock } from './blocks';

/** 翻译视图生命周期：idle 未翻译 → running 流式中 → done 完成；stale 文件已变更 */
export type TranslationPhase = 'idle' | 'running' | 'done' | 'aborted' | 'stale';

/** tab 维度临时翻译状态（共识：不持久化，关 tab 即丢） */
export interface TabTranslation {
  /** 选择器：进入视图即初始化，翻译前的用户选择阶段即可用 */
  targetLanguage: string;
  agentId: string;
  modelId: string | null;
  /** 翻译发起时的文档快照（idle 阶段为空），与当前文件内容比对判断过期 */
  source?: string;
  blocks: SourceBlock[];
  translations: Record<string, string>;
  failedIds: string[];
  phase: TranslationPhase;
}

interface TranslationStore {
  byTab: Record<string, TabTranslation>;
  /** 进入译文视图时初始化选择器（已存在则原样返回，不覆盖用户选择） */
  initSelectors: (
    tabKey: string,
    selectors: { targetLanguage: string; agentId: string; modelId: string | null },
  ) => void;
  /** 局部更新选择器 */
  setSelectors: (
    tabKey: string,
    patch: Partial<{ targetLanguage: string; agentId: string; modelId: string | null }>,
  ) => void;
  /** 用户点击翻译：写入文档快照并进入 running */
  start: (tabKey: string, payload: { source: string; blocks: SourceBlock[] }) => void;
  /** 每批完成回填 */
  setTranslations: (tabKey: string, map: Record<string, string>) => void;
  /** 每批失败标记（可单段重试） */
  setFailed: (tabKey: string, ids: string[]) => void;
  setPhase: (tabKey: string, phase: TranslationPhase) => void;
  /** 底层文件变更：现有译文标记过期（不自动重译） */
  markStale: (tabKey: string) => void;
  clear: (tabKey: string) => void;
}

export const useTranslationStore = create<TranslationStore>((set) => ({
  byTab: {},
  initSelectors: (tabKey, selectors) =>
    set((state) => {
      // 已存在（用户可能改过选择器）→ 原样返回，不覆盖
      if (state.byTab[tabKey]) return state;
      return {
        byTab: {
          ...state.byTab,
          [tabKey]: {
            targetLanguage: selectors.targetLanguage,
            agentId: selectors.agentId,
            modelId: selectors.modelId,
            blocks: [],
            translations: {},
            failedIds: [],
            phase: 'idle',
          },
        },
      };
    }),
  setSelectors: (tabKey, patch) =>
    set((state) => {
      const tab = state.byTab[tabKey];
      if (!tab) return state;
      return { byTab: { ...state.byTab, [tabKey]: { ...tab, ...patch } } };
    }),
  start: (tabKey, payload) =>
    set((state) => {
      const tab = state.byTab[tabKey];
      if (!tab) return state;
      return {
        byTab: {
          ...state.byTab,
          [tabKey]: {
            ...tab,
            source: payload.source,
            blocks: payload.blocks,
            translations: {},
            failedIds: [],
            phase: 'running',
          },
        },
      };
    }),
  setTranslations: (tabKey, map) =>
    set((state) => {
      const tab = state.byTab[tabKey];
      if (!tab) return state;
      return {
        byTab: {
          ...state.byTab,
          [tabKey]: {
            ...tab,
            translations: { ...tab.translations, ...map },
            failedIds: tab.failedIds.filter((id) => !(id in map)),
          },
        },
      };
    }),
  setFailed: (tabKey, ids) =>
    set((state) => {
      const tab = state.byTab[tabKey];
      if (!tab) return state;
      const merged = new Set([...tab.failedIds, ...ids]);
      // 无新增 → 返回原引用（幂等调用不触发重渲染）
      if (merged.size === tab.failedIds.length) return state;
      return {
        byTab: {
          ...state.byTab,
          [tabKey]: {
            ...tab,
            failedIds: [...merged],
          },
        },
      };
    }),
  setPhase: (tabKey, phase) =>
    set((state) => {
      const tab = state.byTab[tabKey];
      // 同态短路：phase 不变时返回原 state 引用，避免订阅方依赖 snapshot
      // 触发无限重渲染（zustand 以引用相等判跳过）
      if (!tab || tab.phase === phase) return state;
      return { byTab: { ...state.byTab, [tabKey]: { ...tab, phase } } };
    }),
  markStale: (tabKey) =>
    set((state) => {
      const tab = state.byTab[tabKey];
      // 未翻译 / 已是 stale → 返回原引用，防止 stale effect 反复触发
      if (!tab || !tab.source || tab.phase === 'stale') return state;
      return { byTab: { ...state.byTab, [tabKey]: { ...tab, phase: 'stale' } } };
    }),
  clear: (tabKey) =>
    set((state) => {
      if (!(tabKey in state.byTab)) return state;
      const next = { ...state.byTab };
      delete next[tabKey];
      return { byTab: next };
    }),
}));

/** 轻量内容指纹（djb2）：文件变更失效比对用，不追求密码学强度 */
export function hashSource(source: string): string {
  let hash = 5381;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
