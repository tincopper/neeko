/**
 * References Peek store（VSCode 式左列表右预览）。
 *
 * 职责：分组 + 按 uri 去重拉取预览文本 + 选择态。**不含跳转实现**——跳转是
 * editor 域的副作用（jdt 类文件 / 项目外只读 tab 只有它建得对），经 `navigate`
 * 端口注入（DIP：本 store 不 import 任何具体跳转出口）。
 * 与 `symbolNavStore` 并列（不污染既有 findUsages 状态机）；展示零改旧弹窗。
 */
import { create } from 'zustand';

import { loadDefinitionTargetContent } from '@/features/lsp/api/definitionTarget';
import type { LspLocation } from '@/features/lsp/types';

import { groupReferencesByFile, windowPreviewLines } from '../referencesPeek';

/** 引用条目上限（与既有 Find Usages 弹窗 200 体例对齐）。 */
export const PEEK_MAX_ITEMS = 200;

/** 跳转端口：由 editor 域在 `openPeek` 时注入（绑定当前 tab 上下文）。 */
export type PeekNavigate = (location: LspLocation) => Promise<void>;

export interface PeekViewItem {
  id: string;
  filePath: string;
  /** 命中行文本（文本不可用时 ''）。 */
  snippet: string;
  previewLines: string[];
  previewBaseLine0: number;
  previewMatchIdx: number;
  matchStartChar: number;
  matchEndChar: number;
  /** 原始引用位置（跳转端口入参；uri / 行列的唯一来源）。 */
  location: LspLocation;
}

export interface PeekFileGroup {
  uri: string;
  filePath: string;
  items: PeekViewItem[];
}

/**
 * 扁平序号 → 条目；越界返回 undefined。
 *
 * `groups` 是条目的唯一来源（不再另存一份扁平 `items`）：双数组只能靠「同引用」
 * 手工同步，任一新写路径漏一处即标题与内容分叉。派生让该不变式无法被打破。
 */
export function peekItemAt(groups: PeekFileGroup[], index: number): PeekViewItem | undefined {
  let n = index;
  for (const g of groups) {
    if (n < g.items.length) return g.items[n];
    n -= g.items.length;
  }
  return undefined;
}

interface ReferencesPeekState {
  open: boolean;
  title: string;
  loading: boolean;
  truncated: boolean;
  /** 条目唯一来源；扁平序号由 `peekItemAt` 派生（不另存 `items`）。 */
  groups: PeekFileGroup[];
  selectedIndex: number;
  /** 预览文本加载用（项目内文件按 UUID 解析）；跳转不使用。 */
  projectId: string | null;
  navigate: PeekNavigate | null;

  openPeek: (opts: {
    projectId: string;
    projectPath: string;
    languageId: string;
    locations: LspLocation[];
    symbolHint?: string;
    navigate: PeekNavigate;
  }) => void;
  setSelectedIndex: (i: number) => void;
  moveSelection: (delta: number) => void;
  confirm: () => Promise<void>;
  close: () => void;
}

/**
 * 在途批次号（模块级）：`openPeek` 自增，异步回填前比对，丢弃被取代/已关闭的批次。
 * 与 `editorStore.navigateGoal.seq` 同一货币性手法。
 */
let peekBatch = 0;

export const useReferencesPeekStore = create<ReferencesPeekState>((set, get) => ({
  open: false,
  title: 'References',
  loading: false,
  truncated: false,
  groups: [],
  selectedIndex: 0,
  projectId: null,
  navigate: null,

  openPeek: ({ projectId, projectPath, languageId, locations, symbolHint, navigate }) => {
    const total = locations.length;
    const batch = ++peekBatch;
    set({
      open: true,
      title: symbolHint ? `References: ${symbolHint} (${total})` : `References (${total})`,
      loading: true,
      truncated: total > PEEK_MAX_ITEMS,
      groups: [],
      selectedIndex: 0,
      projectId,
      navigate,
    });

    void (async () => {
      // 截断前移：先按上限裁剪再分组/拉取——被截掉的文件不白读盘。
      const capped =
        locations.length > PEEK_MAX_ITEMS ? locations.slice(0, PEEK_MAX_ITEMS) : locations;
      const rawGroups = groupReferencesByFile(capped);
      const uris = rawGroups.map((g) => g.uri);
      const settled = await Promise.allSettled(
        uris.map((uri) => loadDefinitionTargetContent(projectId, projectPath, languageId, uri)),
      );
      // 迟到批次丢弃。`open` 单独不足以判定：关闭后立刻重开时 open 仍为 true，
      // 上一批会覆盖新批（表现为标题 B + 内容 A）。批次号才是货币性判据。
      if (!get().open || batch !== peekBatch) return;

      const textByUri = new Map<string, string>();
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.kind !== 'unavailable') {
          textByUri.set(uris[i], r.value.content.content);
        }
      });
      // 同文件多引用共用同一行数组（不按条目复制全文）。
      const linesByUri = new Map<string, string[]>();
      for (const [uri, text] of textByUri) linesByUri.set(uri, text.split(/\r?\n/));

      const groups: PeekFileGroup[] = [];
      for (const g of rawGroups) {
        const viewGroup: PeekFileGroup = { uri: g.uri, filePath: g.filePath, items: [] };
        for (const location of g.items) {
          const { line, character } = location.range.start;
          const full = linesByUri.get(g.uri);
          const slice =
            full !== undefined
              ? windowPreviewLines(full, line)
              : { lines: [] as string[], baseLine0: line, matchLineIdx: 0 };
          viewGroup.items.push({
            id: `peek-${groups.length}-${viewGroup.items.length}-${line}-${character}`,
            filePath: g.filePath,
            snippet: slice.lines[slice.matchLineIdx] ?? '',
            previewLines: slice.lines,
            previewBaseLine0: slice.baseLine0,
            previewMatchIdx: slice.matchLineIdx,
            matchStartChar: character,
            matchEndChar: location.range.end.character,
            location,
          });
        }
        if (viewGroup.items.length > 0) groups.push(viewGroup);
      }

      if (!get().open || batch !== peekBatch) return;
      set({ loading: false, groups, selectedIndex: 0 });
    })();
  },

  setSelectedIndex: (i) => {
    const total = get().groups.reduce((n, g) => n + g.items.length, 0);
    if (total === 0) return;
    set({ selectedIndex: Math.min(Math.max(0, i), total - 1) });
  },

  moveSelection: (delta) => {
    const { groups, selectedIndex } = get();
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    if (total === 0) return;
    set({ selectedIndex: (selectedIndex + delta + total) % total });
  },

  confirm: async () => {
    const { groups, selectedIndex, navigate, open } = get();
    const item = peekItemAt(groups, selectedIndex);
    if (!open || !navigate || !item) {
      get().close();
      return;
    }
    get().close();
    await navigate(item.location);
  },

  close: () => {
    set({
      open: false,
      loading: false,
      truncated: false,
      groups: [],
      selectedIndex: 0,
      projectId: null,
      navigate: null,
    });
  },
}));
