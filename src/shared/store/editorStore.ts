import { create } from 'zustand';

import type { DockSlot } from '@/shared/dock/types';
import type {
  EditorGroupId,
  EditorGroupState,
  EditorSplitLayout,
  ProjectTabs,
  Tab,
  TabData,
} from '@/shared/types';
import { createDefaultEditorLayout, emptyEditorGroup } from '@/shared/types/editorGroup';
import type { FileContent } from '@/shared/types/file';
import type { DiffSource, ViewMode } from '@/shared/types/git';
import type {
  FileTabData,
  TerminalTabData,
  DiffTabData,
  HtmlPreviewTabData,
  PRDetailTabData,
  BrowserTabData,
  AgentChatTabData,
  TabKind,
} from '@/shared/types/tab';
import { emitTabActivated } from '@/shared/utils/editorActivity';
import { tabSpaceKeyOf } from '@/shared/utils/tabIdentity';
import { MAX_TERMINAL_TABS } from '@/shared/utils/terminalTabTitle';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { selectActiveTabId } from './editorTabSelectors';

/**
 * Tab 关闭清理注册表（feature 解耦的按 kind 分发）。
 *
 * 各 feature 通过 `registerTabCleanup(kind, fn)` 注册其 tab 的销毁清理
 * （如 terminal 的 PTY cache 回收、browser 的 webview destroy + 状态移除）。
 * `closeTab` / `clearProjectTabs` 在移除 tab 后调用对应 handler。
 * 以此避免 feature 间（terminal ↔ browser）互相导入造成的循环依赖。
 */
type TabCleanupFn = (tabKey: string, tab: Tab) => void;
const tabCleanupRegistry = new Map<TabKind, TabCleanupFn>();

export function registerTabCleanup(kind: TabKind, fn: TabCleanupFn): void {
  tabCleanupRegistry.set(kind, fn);
}

export function unregisterTabCleanup(kind: TabKind): void {
  tabCleanupRegistry.delete(kind);
}

function runTabCleanup(tabKey: string, tab: Tab): void {
  try {
    tabCleanupRegistry.get(tab.data.kind)?.(tabKey, tab);
  } catch (err) {
    // 清理 handler 异常不得外溢：到此处 store 的移除变更已提交，异常不再有恢复
    // 意义，只会破坏调用方后续流程（closeTab 的事件流 / clearProjectTabs 的多键
    // 空间循环、移除项目后的 store 兜底）。注册表是对 feature 开放的扩展点，故障
    // 隔离属于分发点职责。
    console.error(`[editorStore] tab cleanup failed (kind=${tab.data.kind}, tabId=${tab.id})`, err);
  }
}

function ensureLayout(
  layouts: Record<string, EditorSplitLayout>,
  tabKey: string,
  allTabIds: string[],
  activeTabId: string | null,
): EditorSplitLayout {
  if (layouts[tabKey]) return layouts[tabKey];
  const layout = createDefaultEditorLayout();
  layout.groups.left.tabIds = allTabIds;
  layout.groups.left.activeTabId = activeTabId;
  return layout;
}

/**
 * 字段合并规则：
 *
 * - `keep`：只有拿到**真值**才覆盖（`undefined` 读作「保持原值」）—— 挂载键 / 恢复标记；
 * - `clear`：显式 `undefined` 也是写入（**清除**）—— 切 agent 丢模型、恢复标记一次性消费。
 */
type MergeRule = 'keep' | 'clear';

/**
 * 每类 tab data 的**字段表** —— 新增字段只改这里。
 *
 * 为什么用 `Record<Exclude<keyof X, 'kind'>, MergeRule>` 而不是数组：漏登记的症状是
 * **静默 no-op**（`updateTab` 看起来成功、读回来还是旧值），而漏登记一个字段的数组是
 * 合法的 TypeScript，编译器一声不响。写成 `Record<…>` 之后，类型会强制这张表描述**整个**
 * data 形状 —— 「加字段忘登记」从运行时缺陷变成编译错误。
 *
 * 只登记规则**一致**的 kind。`file` 混用两种规则（必填字段 `keep`、可选字段 `clear`），
 * 需要逐字段 rule，尚未纳入。
 */
const TERMINAL_DATA_FIELDS: Record<Exclude<keyof TerminalTabData, 'kind'>, MergeRule> = {
  agentId: 'keep',
  ptySessionId: 'keep',
  taskCommand: 'keep',
  taskConfigId: 'keep',
  rebuildKey: 'keep',
  resumeFromSessionId: 'keep',
  attachSessionId: 'keep',
};

const AGENT_CHAT_DATA_FIELDS: Record<Exclude<keyof AgentChatTabData, 'kind'>, MergeRule> = {
  agentId: 'clear',
  sessionId: 'clear',
  modelId: 'clear',
  resumeConversationId: 'clear',
  resumeNativeSessionId: 'clear',
  composerDoc: 'clear',
};

/**
 * 按字段表合并；表内一个字段都没出现 ⇒ 不是本 kind 的 partial，**原样返回**（同一引用，
 * 调用方据此避免无意义的 re-render）。
 */
function mergeByFields<T extends { kind: string }>(
  data: T,
  partial: Record<string, unknown>,
  fields: Record<Exclude<keyof T, 'kind'>, MergeRule>,
): T {
  const keys = Object.keys(fields) as Exclude<keyof T, 'kind'>[];
  if (!keys.some((key) => key in partial)) return data;
  const next = { ...data } as Record<string, unknown>;
  for (const key of keys) {
    if (!(key in partial)) continue;
    const value = partial[key as string];
    // `keep`：`undefined` 表示「这次不更新」；`clear`：`undefined` 本身就是写入。
    if (fields[key] === 'keep' && value === undefined) continue;
    next[key as string] = value;
  }
  return next as T;
}

function mergeTabData(data: TabData, partial: Partial<TabData>): TabData {
  if (partial.kind !== undefined && partial.kind !== data.kind) {
    return data;
  }

  switch (data.kind) {
    case 'terminal': {
      return mergeByFields(
        data as TerminalTabData,
        partial as Record<string, unknown>,
        TERMINAL_DATA_FIELDS,
      );
    }
    case 'file': {
      const p = partial as Record<string, unknown>;
      const isFilePartial =
        'content' in p ||
        'isDirty' in p ||
        'filePath' in p ||
        'fileName' in p ||
        'externallyModified' in p ||
        'isUntitled' in p ||
        'untitledName' in p ||
        'initialPreviewMode' in p ||
        'readOnly' in p ||
        'virtualUri' in p;
      if (!isFilePartial) return data;
      const d = data as FileTabData;
      return {
        kind: 'file' as const,
        filePath: p.filePath !== undefined ? (p.filePath as string) : d.filePath,
        fileName: p.fileName !== undefined ? (p.fileName as string) : d.fileName,
        content: p.content !== undefined ? (p.content as FileContent) : d.content,
        isDirty: p.isDirty !== undefined ? (p.isDirty as boolean) : d.isDirty,
        externallyModified:
          'externallyModified' in p
            ? (p.externallyModified as boolean | undefined)
            : d.externallyModified,
        isUntitled: 'isUntitled' in p ? (p.isUntitled as boolean | undefined) : d.isUntitled,
        untitledName: 'untitledName' in p ? (p.untitledName as string | undefined) : d.untitledName,
        initialPreviewMode:
          'initialPreviewMode' in p
            ? (p.initialPreviewMode as 'preview' | 'source' | undefined)
            : d.initialPreviewMode,
        readOnly: 'readOnly' in p ? (p.readOnly as boolean | undefined) : d.readOnly,
        virtualUri: 'virtualUri' in p ? (p.virtualUri as string | undefined) : d.virtualUri,
      };
    }
    case 'diff': {
      const p = partial as Record<string, unknown>;
      if (!('diffSource' in p) && !('combined' in p) && !('scrollToPath' in p)) return data;
      const d = data as DiffTabData;
      return {
        kind: 'diff' as const,
        filePath: p.filePath !== undefined ? (p.filePath as string) : d.filePath,
        fileName: p.fileName !== undefined ? (p.fileName as string) : d.fileName,
        diffSource: p.diffSource !== undefined ? (p.diffSource as DiffSource) : d.diffSource,
        initialMode:
          p.initialMode !== undefined ? (p.initialMode as ViewMode | undefined) : d.initialMode,
        combined: p.combined !== undefined ? (p.combined as boolean) : d.combined,
        combinedFiles:
          p.combinedFiles !== undefined
            ? (p.combinedFiles as import('@/features/git/components/diff/types').CommitFileChange[])
            : d.combinedFiles,
        scrollToPath:
          p.scrollToPath !== undefined ? (p.scrollToPath as string | undefined) : d.scrollToPath,
      };
    }
    case 'html-preview': {
      const p = partial as Record<string, unknown>;
      if (!('filePath' in p)) return data;
      const d = data as HtmlPreviewTabData;
      return {
        kind: 'html-preview' as const,
        filePath: p.filePath !== undefined ? (p.filePath as string) : d.filePath,
        fileName: p.fileName !== undefined ? (p.fileName as string) : d.fileName,
      };
    }
    case 'conversation': {
      return data;
    }
    case 'prDetail': {
      const p = partial as Record<string, unknown>;
      const d = data as PRDetailTabData;
      return {
        kind: 'prDetail' as const,
        projectId: p.projectId !== undefined ? (p.projectId as ProjectId) : d.projectId,
        prNumber: p.prNumber !== undefined ? (p.prNumber as number) : d.prNumber,
        prTitle: p.prTitle !== undefined ? (p.prTitle as string) : d.prTitle,
        prState: p.prState !== undefined ? (p.prState as string) : d.prState,
        prBody: p.prBody !== undefined ? (p.prBody as string | null) : d.prBody,
        prAuthor: p.prAuthor !== undefined ? (p.prAuthor as string) : d.prAuthor,
        prCreatedAt: p.prCreatedAt !== undefined ? (p.prCreatedAt as string) : d.prCreatedAt,
        prUrl: p.prUrl !== undefined ? (p.prUrl as string) : d.prUrl,
        prHeadRef: p.prHeadRef !== undefined ? (p.prHeadRef as string) : d.prHeadRef,
        prBaseRef: p.prBaseRef !== undefined ? (p.prBaseRef as string) : d.prBaseRef,
      };
    }
    case 'browser': {
      const p = partial as Record<string, unknown>;
      const d = data as BrowserTabData;
      return {
        kind: 'browser' as const,
        url: 'url' in p ? (p.url as string) : d.url,
        favicon: 'favicon' in p ? (p.favicon as string | undefined) : d.favicon,
      };
    }
    case 'agent-chat': {
      // 逐字段规则见 `AGENT_CHAT_DATA_FIELDS`：显式 `undefined` 是**清除**语义，
      // 与 terminal 的 `keep` 相反（切 agent 丢模型、恢复标记一次性消费）。
      return mergeByFields(
        data as AgentChatTabData,
        partial as Record<string, unknown>,
        AGENT_CHAT_DATA_FIELDS,
      );
    }
    default:
      return data;
  }
}

/**
 * 把 tab 从 left/right 组移除并追加到 pinnedTabIds 末尾（多 pinned tabs 语义）。
 * 幂等：tab 已在 pinned 列表时直接返回原 layout。
 */
function applyPin(layout: EditorSplitLayout, tabId: string): EditorSplitLayout {
  if (layout.pinnedTabIds.includes(tabId)) return layout;

  const newLeftIds = layout.groups.left.tabIds.filter((id) => id !== tabId);
  const newRightIds = layout.groups.right.tabIds.filter((id) => id !== tabId);
  const stillSplit = layout.isSplit && newRightIds.length > 0;

  return {
    ...layout,
    isSplit: stillSplit,
    activeGroupId: stillSplit ? layout.activeGroupId : 'left',
    pinnedTabIds: [...layout.pinnedTabIds, tabId],
    pinnedActiveTabId: tabId,
    groups: {
      left: {
        tabIds: newLeftIds,
        activeTabId:
          layout.groups.left.activeTabId === tabId
            ? newLeftIds.length > 0
              ? newLeftIds[newLeftIds.length - 1]
              : null
            : layout.groups.left.activeTabId,
      },
      right: {
        tabIds: newRightIds,
        activeTabId:
          layout.groups.right.activeTabId === tabId
            ? newRightIds.length > 0
              ? newRightIds[newRightIds.length - 1]
              : null
            : layout.groups.right.activeTabId,
      },
    },
    // 停靠在槽位宿主的 tab 被 pin 时必须先从 docked 组剔除 —— 否则同一 tab 同时在
    // pinned 与 docked 两组里（G1 单值 surface 破裂 = 双 PTY）。
    docked: {
      left: removeTabFromGroup(layout.docked.left, tabId),
      right: removeTabFromGroup(layout.docked.right, tabId),
    },
  };
}

/**
 * 从单个组移除 tab 并修复该组前台（与 closeTab 同向：优先左邻，其次右邻，再末项，空组 null）。
 *
 * **只修本组**：跨组的 `activeGroupId` / `isSplit` 收敛属于调用方的语义，不在此处猜。
 */
function removeTabFromGroup(group: EditorGroupState, tabId: string): EditorGroupState {
  const idx = group.tabIds.indexOf(tabId);
  if (idx === -1) return group;
  const tabIds = group.tabIds.filter((id) => id !== tabId);
  if (group.activeTabId !== tabId) return { tabIds, activeTabId: group.activeTabId };
  const next = tabIds[idx - 1] ?? tabIds[idx] ?? tabIds[tabIds.length - 1] ?? null;
  return { tabIds, activeTabId: next };
}

/** 源组被移空后收拢中心分屏（与 closeTab 的收拢语义一致：不留两片空 pane）。 */
function collapseEmptySplit(layout: EditorSplitLayout): EditorSplitLayout {
  if (!layout.isSplit) return layout;
  if (layout.groups.right.tabIds.length === 0) {
    return { ...layout, isSplit: false, activeGroupId: 'left' };
  }
  if (layout.groups.left.tabIds.length === 0) {
    return {
      ...layout,
      isSplit: false,
      activeGroupId: 'left',
      groups: { left: layout.groups.right, right: emptyEditorGroup() },
    };
  }
  return layout;
}

/**
 * 从 pinned 列表移除 tab 并交接 pinnedActiveTabId（unpinTab / unpinTabTo 共用）。
 * 被移除的 tab 是当前 pinned 激活项时，激活权交给剩余第一个（无剩余则为 null）。
 */
function releaseFromPinned(
  layout: EditorSplitLayout,
  tabId: string,
): { remainingPinned: string[]; pinnedActiveTabId: string | null } {
  const remainingPinned = layout.pinnedTabIds.filter((id) => id !== tabId);
  return {
    remainingPinned,
    pinnedActiveTabId:
      layout.pinnedActiveTabId === tabId ? (remainingPinned[0] ?? null) : layout.pinnedActiveTabId,
  };
}

/**
 * 用户意图导航目标（定义跳转 / quick-open / 终端与任务链接 / 点断点）。
 *
 * 目标状态模型：`seq` 自增事件键提供「取代 + 货币性」判定 —— 新意图覆盖旧目标（I3），
 * 兑现回调凭 seq 复检货币性，陈旧回调不生效、也不误清新目标。
 * 兑现绑定「视图就绪」（`useNavigateGoal` 经 CodeMirror `requestMeasure` write 阶段）：
 * 成功前不丢（I1）、成功后不重放（I2）。
 * **调试停点不在此列** —— 停点跟随是「编辑器展示当前停点」的派生状态（幂等可重放），
 * 由 `useDebugStopReveal` 从停点 `location` 推出；塞进本槽会遇到「命中即清槽、
 * 兑现失败无从补偿」的时序问题（issue #13）。
 */
export interface NavigateGoal {
  /** 自增事件键：取代判定 + 陈旧回调的货币性检查。 */
  seq: number;
  tabKey: string;
  tabId: string;
  /** 1-based。 */
  line: number;
  /** 0-based。 */
  col: number;
}

/** 用户意图导航目标的 seq 计数器（store 单实例，模块级即可）。 */
let navigateGoalSeq = 0;

/** 生产方写入的意图负载（seq 由 store 分配，调用方不感知）。 */
export interface NavigateGoalInput {
  tabKey: string;
  tabId: string;
  line: number;
  col: number;
}

interface EditorStoreState {
  tabs: Record<string, ProjectTabs>;
  editorLayout: Record<string, EditorSplitLayout>;
  cursorPosition: { line: number; col: number } | null;
  navigateGoal: NavigateGoal | null;

  /**
   * 新增 tab（构造律 P3）：store 键由 `tab.scope` 内部推导（`tabSpaceKeyOf`），调用方
   * 无权指定键 —— 「键 A、tab 身份 B」的 bug 类别在构造上不存在。`targetGroup` 指定
   * 落组：'pinned' 落 pinned 列表并激活；'left'/'right' 落对应组；缺省落当前激活组。
   */
  addTab: (tab: Tab, targetGroup?: EditorGroupId | 'pinned') => void;
  // 注意：此处的 `projectId` 形参实为 **tab 空间键**（`WorkspaceKey | '__app__'`），非项目身份。
  closeTab: (projectId: string, tabId: string) => void;
  activateTab: (projectId: string, tabId: string) => void;
  updateTab: (
    projectId: string,
    tabId: string,
    partial: Partial<TabData> & { title?: string },
  ) => void;
  /**
   * 重命名 tab 身份（改 id）：Save As 等「身份迁移」场景—— untitled id 迁移到
   * canonical path id。保持布局双组归属 / pinned / 激活（都是布局内的 id）一致；
   * 目标 id 已被占用或 old id 不存在时无变化。
   */
  renameTab: (projectId: string, oldTabId: string, newTabId: string) => void;
  clearProjectTabs: (projectId: string) => void;

  splitRight: (tabKey: string, tabId: string) => void;
  moveToRight: (tabKey: string, tabId: string) => void;
  moveToLeft: (tabKey: string, tabId: string) => void;
  /**
   * 把 tab **原子地**移入某个 surface（`'center'` = 当前激活组，或某个 dock 槽）。
   *
   * 唯一的 tab surface 移动入口（G-b）：单次 `set` 内先从左/右/pinned/docked.* **全部**
   * 移除，再插入目标组 —— 分两步写会有一帧双挂载（双 PTY / 双 agent stream）。
   *
   * 返回 true 表示布局变了。返回 false 的三种情况：pinned tab（R9：拒绝，不静默 unpin）、
   * tab / layout 不存在（no-op）、已在目标组且已是该组前台（幂等，不触发订阅）。
   */
  dockTab: (tabKey: string, tabId: string, target: 'center' | DockSlot) => boolean;
  unsplit: (tabKey: string) => void;
  setActiveGroup: (tabKey: string, groupId: EditorGroupId) => void;
  setSplitRatio: (tabKey: string, ratio: number) => void;

  reorderTab: (tabKey: string, groupId: EditorGroupId, tabId: string, overId: string) => void;

  pinTab: (tabKey: string, tabId: string) => void;
  unpinTab: (tabKey: string, tabId: string) => void;
  /** 拖拽 unpin：从 pinned 移除并插入目标组（overId 之前；null 追加尾部），目标组激活该 tab。 */
  unpinTabTo: (
    tabKey: string,
    tabId: string,
    groupId: EditorGroupId,
    overId: string | null,
  ) => void;
  setPinnedPanelRatio: (tabKey: string, ratio: number) => void;

  setCursorPosition: (pos: { line: number; col: number } | null) => void;
  /**
   * 写入用户意图导航目标：seq 自增并覆盖旧目标（取代语义 —— 新意图压旧意图）。
   * 返回本次目标的 seq：生产方失败路径凭它做「只清自己」的货币性清除 ——
   * 迟到的失败清不得吞掉并发写入的新目标。兑现由 `useNavigateGoal` 绑定「视图就绪」完成。
   */
  setNavigateGoal: (target: NavigateGoalInput) => number;
  /**
   * 清除导航目标：仅当前 goal 就是该 seq 时清（货币性安全 —— 兑现回调与生产方失败路径
   * 一律凭 seq 清除自己的目标，不误伤并发新目标）。
   */
  clearNavigateGoal: (seq: number) => void;
}

/**
 * tab 移除路径共用的导航目标清理（私有 helper，不对外暴露）：goal 指向的 tab 被移除后
 * 永远无法兑现，且滞留 goal 会在日后重开同文件时被陈旧目标「换弹」跳转。必须在移除
 * 动作的**同一 set 更新**内展开返回（单一突变点）；仅在真实发生移除的返回分支调用，
 * 早退分支（pinned 拒关 / tab 不存在 / tab 空间缺失）自然保留 goal。
 * `tabId` 缺省时仅按 tabKey 匹配 —— 用于整项目 tab 空间移除（clearProjectTabs）。
 */
function dropNavigateGoalFor(
  state: EditorStoreState,
  tabKey: string,
  tabId?: string,
): { navigateGoal: NavigateGoal | null } | null {
  const goal = state.navigateGoal;
  if (!goal || goal.tabKey !== tabKey) return null;
  if (tabId !== undefined && goal.tabId !== tabId) return null;
  return { navigateGoal: null };
}

export const useEditorStore = create<EditorStoreState>((set) => ({
  tabs: {},
  editorLayout: {},
  cursorPosition: null,
  navigateGoal: null,

  addTab: (tab, targetGroup) =>
    set((state) => {
      const projectId = tabSpaceKeyOf(tab.scope);
      const existing = state.tabs[projectId];

      if (tab.data.kind === 'terminal') {
        const terminalCount = (existing?.tabs ?? []).filter(
          (t) => t.data.kind === 'terminal',
        ).length;
        // 配额门（唯一的硬门）：数字来自 `shared/utils/terminalTabTitle`，
        // 与 terminal 端口、侧栏入口同一来源。
        if (terminalCount >= MAX_TERMINAL_TABS) return state;
      }

      if (existing?.tabs.some((t) => t.id === tab.id)) return state;

      // Diff tabs: only allow one at a time, replace existing if opening a new one
      let filteredTabs = existing?.tabs ?? [];
      if (tab.data.kind === 'diff') {
        filteredTabs = filteredTabs.filter((t) => t.data.kind !== 'diff');
      }

      const projectTabs: ProjectTabs = existing
        ? { tabs: [...filteredTabs, tab] }
        : { tabs: [tab] };

      const newTabs = { ...state.tabs, [projectId]: projectTabs };

      const layout = ensureLayout(
        state.editorLayout,
        projectId,
        projectTabs.tabs.map((t) => t.id),
        tab.id,
      );
      // 落组：'pinned' 进 pinned 列表（末尾追加）并激活；其余落到指定组或
      // 缺省激活组。'pinned' 分支需把新 tab 从组里排除——ensureLayout 在
      // layout 缺失时会将 allTabIds 全塞进 left，避免 pinned/组双重归属。
      let newLayout: EditorSplitLayout;
      if (targetGroup === 'pinned') {
        newLayout = {
          ...layout,
          pinnedTabIds: [...layout.pinnedTabIds, tab.id],
          pinnedActiveTabId: tab.id,
          groups: {
            ...layout.groups,
            left: {
              ...layout.groups.left,
              tabIds: layout.groups.left.tabIds.filter((id) => id !== tab.id),
            },
            right: {
              ...layout.groups.right,
              tabIds: layout.groups.right.tabIds.filter((id) => id !== tab.id),
            },
          },
        };
      } else {
        const activeGroupId = targetGroup ?? layout.activeGroupId;
        newLayout = {
          ...layout,
          groups: {
            ...layout.groups,
            [activeGroupId]: {
              ...layout.groups[activeGroupId],
              tabIds: layout.groups[activeGroupId].tabIds.includes(tab.id)
                ? layout.groups[activeGroupId].tabIds
                : [...layout.groups[activeGroupId].tabIds, tab.id],
              activeTabId: tab.id,
            },
          },
        };
      }

      queueMicrotask(() => {
        emitTabActivated(projectId, tab.id, tab);
      });

      return {
        tabs: newTabs,
        editorLayout: { ...state.editorLayout, [projectId]: newLayout },
      };
    }),

  closeTab: (projectId, tabId) => {
    // 预取将被移除的 tab，用于按 kind 触发清理（browser 销毁 webview 等）。
    const current = useEditorStore.getState();
    const removed = current.tabs[projectId]?.tabs.find((t) => t.id === tabId);
    const pinned = current.editorLayout[projectId]?.pinnedTabIds.includes(tabId) ?? false;

    set((state) => {
      const existing = state.tabs[projectId];
      if (!existing) return state;

      const idx = existing.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;

      if (state.editorLayout[projectId]?.pinnedTabIds.includes(tabId)) return state;

      const remaining = existing.tabs.filter((t) => t.id !== tabId);
      // 前台由布局派生（`selectActiveTabId`），不再读已删除的空间级投影。
      const foreground = selectActiveTabId(state, projectId);
      let newActiveId: string | null = foreground;

      if (foreground === tabId) {
        if (remaining.length === 0) {
          newActiveId = null;
        } else {
          const layout = state.editorLayout[projectId];
          let groupId: EditorGroupId = 'left';
          if (layout?.groups.right.tabIds.includes(tabId)) groupId = 'right';
          const groupIds = layout?.groups[groupId]?.tabIds;
          const groupIdx = groupIds?.indexOf(tabId) ?? -1;

          if (groupIdx > 0) {
            newActiveId = groupIds![groupIdx - 1];
          } else if (groupIdx >= 0 && groupIds && groupIds.length > 1) {
            newActiveId = groupIds[groupIdx + 1];
          } else if (layout) {
            newActiveId = remaining[remaining.length - 1].id;
          } else {
            // No layout yet (e.g. session-restored tabs): keep the tab-bar
            // order so the adjacent tab is selected, mirroring the layout
            // branch above. Without this the active tab jumps to the last
            // remaining tab, which the UI fallback layout also misreads.
            const origIdx = idx;
            if (origIdx > 0) {
              newActiveId = remaining[origIdx - 1].id;
            } else if (remaining.length > 1) {
              newActiveId = remaining[origIdx].id;
            } else {
              newActiveId = remaining[remaining.length - 1].id;
            }
          }
        }
      }

      const newTabs = {
        ...state.tabs,
        [projectId]: { tabs: remaining },
      };

      let newEditorLayout = state.editorLayout;
      const layout = state.editorLayout[projectId];
      if (layout) {
        let groupId: EditorGroupId = 'left';
        if (layout.groups.right.tabIds.includes(tabId)) groupId = 'right';

        const updatedGroupIds = layout.groups[groupId].tabIds.filter((id) => id !== tabId);
        const groupWasActive = layout.groups[groupId].activeTabId === tabId;
        let groupNewActiveId = layout.groups[groupId].activeTabId;

        if (groupWasActive) {
          if (updatedGroupIds.length === 0) {
            groupNewActiveId = null;
          } else {
            const oldIdx = layout.groups[groupId].tabIds.indexOf(tabId);
            const prev = oldIdx > 0 ? layout.groups[groupId].tabIds[oldIdx - 1] : null;
            const next =
              oldIdx < layout.groups[groupId].tabIds.length - 1
                ? layout.groups[groupId].tabIds[oldIdx + 1]
                : null;
            if (prev && updatedGroupIds.includes(prev)) {
              groupNewActiveId = prev;
            } else if (next && updatedGroupIds.includes(next)) {
              groupNewActiveId = next;
            } else {
              groupNewActiveId = updatedGroupIds[updatedGroupIds.length - 1];
            }
          }
        }

        let newLayout: EditorSplitLayout = {
          ...layout,
          groups: {
            ...layout.groups,
            [groupId]: {
              ...layout.groups[groupId],
              tabIds: updatedGroupIds,
              activeTabId: groupNewActiveId,
            },
          },
        };

        if (newLayout.isSplit && newLayout.groups.right.tabIds.length === 0) {
          newLayout = {
            ...newLayout,
            isSplit: false,
            activeGroupId: 'left',
          };
        }

        if (newLayout.isSplit && newLayout.groups.left.tabIds.length === 0) {
          newLayout = {
            ...newLayout,
            isSplit: false,
            activeGroupId: 'left',
            groups: {
              left: newLayout.groups.right,
              right: { tabIds: [], activeTabId: null },
            },
          };
        }

        // Ensure activeGroupId points to the group containing newActiveId.
        // Without this, closing the last tab in the active group while tabs
        // remain in the other group leaves a blank content area.
        if (newActiveId && newLayout.isSplit) {
          const leftHasTab = newLayout.groups.left.tabIds.includes(newActiveId);
          const rightHasTab = newLayout.groups.right.tabIds.includes(newActiveId);
          if (leftHasTab && !rightHasTab) {
            newLayout = { ...newLayout, activeGroupId: 'left' };
          } else if (rightHasTab && !leftHasTab) {
            newLayout = { ...newLayout, activeGroupId: 'right' };
          }
        }

        // 停靠在槽位宿主的 tab：同样从所在 docked 组剔除并修复该组前台（G1 单值 surface）
        const dockedSlot: DockSlot | null = layout.docked.left.tabIds.includes(tabId)
          ? 'left'
          : layout.docked.right.tabIds.includes(tabId)
            ? 'right'
            : null;
        if (dockedSlot) {
          newLayout = {
            ...newLayout,
            docked: {
              ...newLayout.docked,
              [dockedSlot]: removeTabFromGroup(newLayout.docked[dockedSlot], tabId),
            },
          };
        }

        newEditorLayout = { ...state.editorLayout, [projectId]: newLayout };
      } else if (remaining.length > 0) {
        // 不变量 I1（有 tab 的空间必有 layout）成立后本分支不可达，保留作防御：
        // 缺失 layout 时建一份与剩余 tab 同步的 layout，前台落到一个存活 tab（本节
        // 依赖的旧字段 `existing.activeTabId` 已删除，故用 remaining 推导）。
        const created = ensureLayout(
          state.editorLayout,
          projectId,
          remaining.map((t) => t.id),
          newActiveId ?? remaining[remaining.length - 1].id,
        );
        newEditorLayout = { ...state.editorLayout, [projectId]: created };
      }

      return {
        tabs: newTabs,
        editorLayout: newEditorLayout,
        // goal 指向的 tab 已随本次移除：同一 set 更新内清除，避免滞留目标日后「换弹」跳转。
        ...dropNavigateGoalFor(state, projectId, tabId),
      };
    });

    if (removed && !pinned) runTabCleanup(projectId, removed);
  },

  activateTab: (projectId, tabId) =>
    set((state) => {
      const existing = state.tabs[projectId];
      if (!existing) return state;

      if (!existing.tabs.some((t) => t.id === tabId)) return state;

      let newEditorLayout = state.editorLayout;
      const layout = state.editorLayout[projectId];
      if (layout) {
        // pinned tab 激活：只更新 pinned 面板激活状态，不把 tab 加入 left/right 组
        if (layout.pinnedTabIds.includes(tabId)) {
          newEditorLayout = {
            ...state.editorLayout,
            [projectId]: {
              ...layout,
              pinnedActiveTabId: tabId,
            },
          };
        } else if (layout.docked.left.tabIds.includes(tabId)) {
          // 停靠 tab：只改它所在宿主组的前台（不动中心 activeGroupId —— 两个 surface 正交）
          newEditorLayout =
            layout.docked.left.activeTabId === tabId
              ? state.editorLayout
              : {
                  ...state.editorLayout,
                  [projectId]: {
                    ...layout,
                    docked: {
                      ...layout.docked,
                      left: { ...layout.docked.left, activeTabId: tabId },
                    },
                  },
                };
        } else if (layout.docked.right.tabIds.includes(tabId)) {
          newEditorLayout =
            layout.docked.right.activeTabId === tabId
              ? state.editorLayout
              : {
                  ...state.editorLayout,
                  [projectId]: {
                    ...layout,
                    docked: {
                      ...layout.docked,
                      right: { ...layout.docked.right, activeTabId: tabId },
                    },
                  },
                };
        } else {
          let groupId: EditorGroupId = layout.activeGroupId;
          if (layout.groups.right.tabIds.includes(tabId)) groupId = 'right';
          else if (layout.groups.left.tabIds.includes(tabId)) groupId = 'left';
          newEditorLayout = {
            ...state.editorLayout,
            [projectId]: {
              ...layout,
              activeGroupId: groupId,
              groups: {
                ...layout.groups,
                [groupId]: {
                  ...layout.groups[groupId],
                  activeTabId: tabId,
                },
              },
            },
          };
        }
      } else {
        // 不变量 I1 成立后本分支不可达，保留作防御（缺失 layout 时建一份）。
        newEditorLayout = {
          ...state.editorLayout,
          [projectId]: ensureLayout(
            state.editorLayout,
            projectId,
            existing.tabs.map((t) => t.id),
            tabId,
          ),
        };
      }

      // Notify listeners after state is applied (MRU / recent files).
      queueMicrotask(() => {
        const tabs = useEditorStore.getState().tabs[projectId];
        const tab = tabs?.tabs.find((t) => t.id === tabId);
        emitTabActivated(projectId, tabId, tab);
      });

      // 激活 = 写布局（组激活 / pinned 两分支不变）；空间级与顶层投影字段已删除。
      return { editorLayout: newEditorLayout };
    }),

  updateTab: (projectId, tabId, partial) =>
    set((state) => {
      const existing = state.tabs[projectId];
      if (!existing) return state;

      const target = existing.tabs.find((t) => t.id === tabId);
      if (!target) return state;

      const updatedData = mergeTabData(target.data, partial);
      const updatedTab: Tab = {
        ...target,
        data: updatedData,
        title: partial.title !== undefined ? partial.title : target.title,
      };

      return {
        tabs: {
          ...state.tabs,
          [projectId]: {
            ...existing,
            tabs: existing.tabs.map((t) => (t.id === tabId ? updatedTab : t)),
          },
        },
      };
    }),

  renameTab: (projectId, oldTabId, newTabId) =>
    set((state) => {
      if (oldTabId === newTabId) return state;
      const existing = state.tabs[projectId];
      if (!existing) return state;
      if (!existing.tabs.some((t) => t.id === oldTabId)) return state;
      // 目标 id 已被其他 tab 占用 → 拒绝（身份必须保持唯一）
      if (existing.tabs.some((t) => t.id === newTabId)) return state;

      const tabs = existing.tabs.map((t) => (t.id === oldTabId ? { ...t, id: newTabId } : t));

      const layout = state.editorLayout[projectId];
      const newEditorLayout = layout
        ? {
            ...state.editorLayout,
            [projectId]: {
              ...layout,
              pinnedTabIds: layout.pinnedTabIds.map((id) => (id === oldTabId ? newTabId : id)),
              pinnedActiveTabId:
                layout.pinnedActiveTabId === oldTabId ? newTabId : layout.pinnedActiveTabId,
              groups: {
                left: {
                  tabIds: layout.groups.left.tabIds.map((id) => (id === oldTabId ? newTabId : id)),
                  activeTabId:
                    layout.groups.left.activeTabId === oldTabId
                      ? newTabId
                      : layout.groups.left.activeTabId,
                },
                right: {
                  tabIds: layout.groups.right.tabIds.map((id) => (id === oldTabId ? newTabId : id)),
                  activeTabId:
                    layout.groups.right.activeTabId === oldTabId
                      ? newTabId
                      : layout.groups.right.activeTabId,
                },
              },
              // 停靠组同样要迁：id 是布局里的身份，漏一处就会留下幽灵 id（G1/G2）
              docked: {
                left: {
                  tabIds: layout.docked.left.tabIds.map((id) => (id === oldTabId ? newTabId : id)),
                  activeTabId:
                    layout.docked.left.activeTabId === oldTabId
                      ? newTabId
                      : layout.docked.left.activeTabId,
                },
                right: {
                  tabIds: layout.docked.right.tabIds.map((id) => (id === oldTabId ? newTabId : id)),
                  activeTabId:
                    layout.docked.right.activeTabId === oldTabId
                      ? newTabId
                      : layout.docked.right.activeTabId,
                },
              },
            },
          }
        : state.editorLayout;

      return {
        tabs: { ...state.tabs, [projectId]: { tabs } },
        editorLayout: newEditorLayout,
      };
    }),

  clearProjectTabs: (projectId) => {
    const existing = useEditorStore.getState().tabs[projectId];

    set((state) => {
      const existingTabs = state.tabs[projectId];
      if (!existingTabs) return state;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [projectId]: _tmp, ...rest } = state.tabs;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [projectId]: _tmp2, ...restLayouts } = state.editorLayout;
      return {
        tabs: rest,
        editorLayout: restLayouts,
        // 整项目 tab 空间被移除：该项目键下的 goal 一并清除（不限 tabId）。
        ...dropNavigateGoalFor(state, projectId),
      };
    });

    if (existing) {
      for (const tab of existing.tabs) {
        runTabCleanup(projectId, tab);
      }
    }
  },

  splitRight: (tabKey, tabId) =>
    set((state) => {
      const projectTabs = state.tabs[tabKey];
      if (!projectTabs) return state;
      if (!projectTabs.tabs.some((t) => t.id === tabId)) return state;

      const layout = ensureLayout(
        state.editorLayout,
        tabKey,
        projectTabs.tabs.map((t) => t.id),
        selectActiveTabId(state, tabKey),
      );

      const newLeftIds = layout.groups.left.tabIds.filter((id) => id !== tabId);
      const newRightIds = layout.isSplit
        ? layout.groups.right.tabIds.includes(tabId)
          ? layout.groups.right.tabIds
          : [...layout.groups.right.tabIds, tabId]
        : [tabId];

      const newLayout: EditorSplitLayout = {
        ...layout,
        isSplit: true,
        activeGroupId: 'right',
        groups: {
          left: {
            ...layout.groups.left,
            tabIds: newLeftIds,
            activeTabId:
              layout.groups.left.activeTabId === tabId
                ? newLeftIds.length > 0
                  ? newLeftIds[newLeftIds.length - 1]
                  : null
                : layout.groups.left.activeTabId,
          },
          right: {
            ...layout.groups.right,
            tabIds: newRightIds,
            activeTabId: tabId,
          },
        },
      };

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  moveToRight: (tabKey, tabId) =>
    set((state) => {
      const projectTabs = state.tabs[tabKey];
      if (!projectTabs) return state;
      if (!projectTabs.tabs.some((t) => t.id === tabId)) return state;

      const layout = ensureLayout(
        state.editorLayout,
        tabKey,
        projectTabs.tabs.map((t) => t.id),
        selectActiveTabId(state, tabKey),
      );

      if (layout.groups.right.tabIds.includes(tabId)) return state;

      const newLeftIds = layout.groups.left.tabIds.filter((id) => id !== tabId);
      const newRightIds = [...layout.groups.right.tabIds, tabId];

      const newLayout: EditorSplitLayout = {
        ...layout,
        isSplit: true,
        activeGroupId: 'right',
        groups: {
          left: {
            ...layout.groups.left,
            tabIds: newLeftIds,
            activeTabId:
              layout.groups.left.activeTabId === tabId
                ? newLeftIds.length > 0
                  ? newLeftIds[newLeftIds.length - 1]
                  : null
                : layout.groups.left.activeTabId,
          },
          right: {
            ...layout.groups.right,
            tabIds: newRightIds,
            activeTabId: tabId,
          },
        },
      };

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  moveToLeft: (tabKey, tabId) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout) return state;

      if (layout.groups.left.tabIds.includes(tabId)) return state;

      const newRightIds = layout.groups.right.tabIds.filter((id) => id !== tabId);
      const newLeftIds = [...layout.groups.left.tabIds, tabId];

      let newLayout: EditorSplitLayout = {
        ...layout,
        activeGroupId: 'left',
        groups: {
          left: {
            ...layout.groups.left,
            tabIds: newLeftIds,
            activeTabId: tabId,
          },
          right: {
            ...layout.groups.right,
            tabIds: newRightIds,
            activeTabId: newRightIds.length > 0 ? newRightIds[newRightIds.length - 1] : null,
          },
        },
      };

      if (newLayout.groups.right.tabIds.length === 0) {
        newLayout = { ...newLayout, isSplit: false };
      }

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  dockTab: (tabKey, tabId, target) => {
    let changed = false;
    set((state) => {
      const existing = state.tabs[tabKey];
      if (!existing?.tabs.some((t) => t.id === tabId)) return state;
      const layout = state.editorLayout[tabKey];
      if (!layout) return state;
      // R9：pinned tab 拒绝停靠（不静默 unpin —— 调用方提示，不强行改变用户钉住意图）
      if (layout.pinnedTabIds.includes(tabId)) return state;

      const centerGroupId = layout.activeGroupId;
      const targetGroup =
        target === 'center' ? layout.groups[centerGroupId] : layout.docked[target];
      // 幂等：已在目标组且已是该组前台 ⇒ 无需移动，也不写 store（不触发订阅）
      if (targetGroup.tabIds.includes(tabId) && targetGroup.activeTabId === tabId) return state;

      // 先全域移除（四组都剔一遍），再插入目标组：单帧双挂载在构造上不可能（I3）
      const groups = {
        left: removeTabFromGroup(layout.groups.left, tabId),
        right: removeTabFromGroup(layout.groups.right, tabId),
      };
      const docked = {
        left: removeTabFromGroup(layout.docked.left, tabId),
        right: removeTabFromGroup(layout.docked.right, tabId),
      };

      let next: EditorSplitLayout;
      if (target === 'center') {
        groups[centerGroupId] = {
          tabIds: [...groups[centerGroupId].tabIds, tabId],
          // 从 dock 回中心：落到激活组并激活（用户意图 = 回到中间区看它）
          activeTabId: tabId,
        };
        next = { ...layout, activeGroupId: centerGroupId, groups, docked };
      } else {
        docked[target] = {
          tabIds: [...docked[target].tabIds, tabId],
          // 移进去就该看见它
          activeTabId: tabId,
        };
        next = { ...layout, groups, docked };
      }
      next = collapseEmptySplit(next);

      changed = true;
      return { editorLayout: { ...state.editorLayout, [tabKey]: next } };
    });
    return changed;
  },

  unsplit: (tabKey) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout || !layout.isSplit) return state;

      const allTabIds = [...layout.groups.left.tabIds, ...layout.groups.right.tabIds];
      const activeTabId =
        layout.activeGroupId === 'right'
          ? layout.groups.right.activeTabId
          : layout.groups.left.activeTabId;

      const newLayout: EditorSplitLayout = {
        ...layout,
        isSplit: false,
        activeGroupId: 'left',
        groups: {
          left: {
            tabIds: allTabIds,
            activeTabId: activeTabId ?? allTabIds[allTabIds.length - 1] ?? null,
          },
          right: { tabIds: [], activeTabId: null },
        },
      };

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  setActiveGroup: (tabKey, groupId) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout || layout.activeGroupId === groupId) return state;

      const newLayout: EditorSplitLayout = {
        ...layout,
        activeGroupId: groupId,
      };

      return {
        // 换 pane 即改「前台」：投影必须跟上，否则仲裁/Cmd+W 仍指向上一个 pane 的 tab。
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  setSplitRatio: (tabKey, ratio) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout) return state;

      const clamped = Math.max(0.3, Math.min(0.7, ratio));
      return {
        editorLayout: {
          ...state.editorLayout,
          [tabKey]: { ...layout, ratio: clamped },
        },
      };
    }),

  reorderTab: (tabKey, groupId, tabId, overId) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout) return state;
      const group = layout.groups[groupId];
      if (!group) return state;

      const oldIndex = group.tabIds.indexOf(tabId);
      const newIndex = group.tabIds.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return state;

      const newTabIds = [...group.tabIds];
      newTabIds.splice(oldIndex, 1);
      newTabIds.splice(newIndex, 0, tabId);

      return {
        editorLayout: {
          ...state.editorLayout,
          [tabKey]: {
            ...layout,
            groups: {
              ...layout.groups,
              [groupId]: {
                ...group,
                tabIds: newTabIds,
              },
            },
          },
        },
      };
    }),

  pinTab: (tabKey, tabId) =>
    set((state) => {
      const projectTabs = state.tabs[tabKey];
      if (!projectTabs) return state;
      if (!projectTabs.tabs.some((t) => t.id === tabId)) return state;

      const layout = ensureLayout(
        state.editorLayout,
        tabKey,
        projectTabs.tabs.map((t) => t.id),
        selectActiveTabId(state, tabKey),
      );

      const newLayout = applyPin(layout, tabId);

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  unpinTab: (tabKey, tabId) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout || !layout.pinnedTabIds.includes(tabId)) return state;

      const { remainingPinned, pinnedActiveTabId } = releaseFromPinned(layout, tabId);
      const leftIds = [tabId, ...layout.groups.left.tabIds.filter((id) => id !== tabId)];

      const newLayout: EditorSplitLayout = {
        ...layout,
        pinnedTabIds: remainingPinned,
        pinnedActiveTabId,
        groups: {
          ...layout.groups,
          left: {
            tabIds: leftIds,
            activeTabId: layout.groups.left.activeTabId ?? tabId,
          },
        },
      };

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  unpinTabTo: (tabKey, tabId, groupId, overId) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout || !layout.pinnedTabIds.includes(tabId)) return state;
      const group = layout.groups[groupId];
      if (!group) return state;

      const { remainingPinned, pinnedActiveTabId } = releaseFromPinned(layout, tabId);
      const targetIds = group.tabIds.filter((id) => id !== tabId);
      const overIndex = overId ? targetIds.indexOf(overId) : -1;
      // 与 reorderTab 的 splice 语义一致：插到 over tab 之前；over 缺失则追加尾部
      targetIds.splice(overIndex === -1 ? targetIds.length : overIndex, 0, tabId);

      const newLayout: EditorSplitLayout = {
        ...layout,
        pinnedTabIds: remainingPinned,
        pinnedActiveTabId,
        groups: {
          ...layout.groups,
          [groupId]: {
            tabIds: targetIds,
            // 拖入的 tab 是用户主动放置，激活它（对齐 VSCode 拖拽行为）
            activeTabId: tabId,
          },
        },
      };

      return {
        editorLayout: { ...state.editorLayout, [tabKey]: newLayout },
      };
    }),

  setPinnedPanelRatio: (tabKey, ratio) =>
    set((state) => {
      const layout = state.editorLayout[tabKey];
      if (!layout) return state;

      const clamped = Math.max(0.1, Math.min(0.75, ratio));
      return {
        editorLayout: {
          ...state.editorLayout,
          [tabKey]: { ...layout, pinnedPanelRatio: clamped },
        },
      };
    }),

  setCursorPosition: (pos) => set(() => ({ cursorPosition: pos })),

  setNavigateGoal: (target) => {
    const seq = ++navigateGoalSeq;
    set(() => ({ navigateGoal: { seq, ...target } }));
    return seq;
  },

  clearNavigateGoal: (seq) =>
    set((state) => {
      const goal = state.navigateGoal;
      if (!goal || goal.seq !== seq) return state;
      return { navigateGoal: null };
    }),
}));

/**
 * 当前单元（tab 空间键 `tabKey`）的激活 tab id；无该空间 / 无激活 tab 时为 `null`。
 *
 * **命令式薄封装**：内部即 `selectActiveTabId`（前台 = 布局激活编辑器组的激活 tab），
 * 使命令式调用点签名不变、语义变为派生。渲染期用同名 selector（`useEditorStore(s =>
 * selectActiveTabId(s, tabKey))`）。
 */
export function activeTabIdOf(tabKey: string): string | null {
  return selectActiveTabId(useEditorStore.getState(), tabKey);
}
