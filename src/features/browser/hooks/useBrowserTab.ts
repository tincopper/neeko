import { useCallback, useEffect, useRef } from 'react';

import { sendToTerminal } from '@/features/terminal';
import { BROWSER_PROMPT_SUBMITTED_EVENT, GIT_CHANGED_EVENT } from '@/shared/events';
import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
import { useTauriEvent } from '@/shared/hooks/useTauriEvent';
import type { BrowserTabState } from '@/shared/store/browserTabsStore';
import { useBrowserTabsStore } from '@/shared/store/browserTabsStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useOverlayStore } from '@/shared/store/overlayStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChangedEvent } from '@/shared/types';
import {
  armProjectAutoRefresh,
  disarmProjectAutoRefresh,
  isProjectAutoRefreshArmed,
} from '@/shared/utils/browserAutoRefresh';
import { fileUrlToFilePath, hostFromUrl } from '@/shared/utils/browserUtils';
import { canGoBack, canGoForward, recordNavigation } from '@/shared/utils/historyStack';

import {
  findAgentCliTab,
  formatPickerMessage,
  getThemeColors,
  type PickerElement,
} from '../components/pickerUtils';
import { ensureBrowserTabCleanupRegistered } from '../utils/browserTabCleanup';

import { getBrowserTabLabel } from './useBrowserConstants';
import { useBrowserPicker } from './useBrowserPicker';
import { useBrowserWebview } from './useBrowserWebview';

/** Rust 端 picker 提交 payload（label 为 webview 标识，缺失时由面板回退处理）。 */
interface PromptSubmittedPayload {
  prompt: string;
  elements: PickerElement[];
  label?: string;
}

interface UseBrowserTabOptions {
  tabKey: string;
  tabId: string;
  projectId: string;
  /** 该 tab 是否「可见」：所在 pane 为当前激活组且项目激活。 */
  isActive: boolean;
  showToast: (message: string, type?: 'info' | 'error') => void;
}

/**
 * 编辑器 Browser tab 的适配 hook。
 *
 * 每个 Browser tab 独立 webview（label = `neeko-browser-tab-{tabId}`）与独立状态
 * （`useBrowserTabsStore`）。可见性 = `isActive`（pane 激活 + 项目激活）。导航/页面
 * 事件/懒创建/bounds 同步等机制由 `useBrowserWebview` 承载。
 */
export function useBrowserTab({
  tabKey,
  tabId,
  projectId,
  isActive,
  showToast,
}: UseBrowserTabOptions) {
  const label = getBrowserTabLabel(tabId);

  // 确保 tab 关闭清理已注册（幂等）：closeTab 时销毁 webview + 移除状态
  ensureBrowserTabCleanupRegistered();

  const browserState = useBrowserTabsStore((s) => s.states[tabId] ?? null);

  // 惰性初始化 per-tab 状态：放 effect 而非渲染体，避免渲染期同步 set 其他 store
  // 触发 React StrictMode「Cannot update a component while rendering」警告。
  // effect 声明早于 useBrowserWebview 的懒创建 effect，故懒创建读取 getUrl 时状态已就绪。
  useEffect(() => {
    useBrowserTabsStore.getState().getTabState(tabId, label);
  }, [tabId, label]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isCreatedRef = useRef(false);

  // 任一 DOM 浮层打开（action 菜单 / quick-open / 右键菜单 / 确认对话框）期间，
  // 隐藏内容区的悬浮 Browser webview，避免其遮挡浮层（z-order 专项）。
  const anyOverlayOpen = useOverlayStore((s) => s.count > 0);
  // tab 是否仍存在于 editorStore：tab 被关闭后（closeTab 移除）若组件因未批处理
  // 渲染还存活一拍，可见性强制为 false —— 杜绝「关闭后 webview 被重新创建/显示」。
  const tabExists = useEditorStore((s) => s.tabs[tabKey]?.tabs.some((t) => t.id === tabId));
  const visible = isActive && !anyOverlayOpen && !!tabExists;

  // 同步 store 的 isCreated 到 ref（懒创建/picker 门控使用）
  useEffect(() => {
    isCreatedRef.current = browserState?.isCreated ?? false;
  }, [browserState?.isCreated]);

  const getUrl = useCallback(
    () => useBrowserTabsStore.getState().getTabState(tabId, label)?.url ?? '',
    [tabId, label],
  );

  const setTabState = useCallback(
    (patch: Partial<BrowserTabState>) => useBrowserTabsStore.getState().setTabState(tabId, patch),
    [tabId],
  );

  const removeTabState = useCallback(
    () => useBrowserTabsStore.getState().removeTabState(tabId),
    [tabId],
  );

  const onUrlChange = useCallback(
    (url: string) => {
      const state = useBrowserTabsStore.getState().getTabState(tabId, label);
      useBrowserTabsStore.getState().setTabState(tabId, {
        history: recordNavigation(state.history, url),
      });
      // 同步编辑器 tab 的 data.url；导航时标题兜底为 host（避免跨站后旧标题滞留，
      // 页面 meta 到达后 onPageMeta 再覆盖为网站名）
      useEditorStore.getState().updateTab(tabKey, tabId, {
        url,
        title: hostFromUrl(url),
      });
    },
    [tabId, tabKey, label],
  );

  const onPageMeta = useCallback(
    (meta: { title: string; favicon: string }) => {
      // 同步编辑器 tab 标题（网站名）与图标（favicon）
      useEditorStore.getState().updateTab(tabKey, tabId, {
        title: meta.title,
        favicon: meta.favicon,
      });
    },
    [tabKey, tabId],
  );

  const webview = useBrowserWebview({
    label,
    getUrl,
    isCreated: browserState?.isCreated ?? false,
    setState: setTabState,
    removeState: removeTabState,
    visible,
    containerRef,
    onUrlChange,
    onPageMeta,
    onVisibleChange: (nextVisible) => {
      if (nextVisible) {
        setTabState({ isActive: true, lastActiveAt: Date.now() });
      } else {
        setTabState({ isActive: false });
      }
    },
  });

  // 元素选择器（picker → agent CLI 的 prompt 路由在本 hook 下方接入）
  const { isPicking, startPicker, stopPicker, reinjectPicker } = useBrowserPicker({
    label,
    isCreatedRef,
    getThemeColors,
  });

  // Listen: prompt submitted from this tab's webview → 路由到同项目的 Agent CLI tab
  useTauriEvent<PromptSubmittedPayload>(
    BROWSER_PROMPT_SUBMITTED_EVENT,
    useCallback(
      (payload) => {
        const data: PromptSubmittedPayload =
          typeof payload === 'string' ? JSON.parse(payload) : payload;
        // 仅处理本 tab 的 webview 提交；无 label(旧版注入)由面板回退处理
        if (!data?.label || data.label !== label) return;
        if (!data?.prompt || !Array.isArray(data.elements) || data.elements.length === 0) return;

        const editorState = useEditorStore.getState();
        const targetTabId = findAgentCliTab(editorState.tabs[projectId]);
        if (!targetTabId) {
          showToast('Please open an Agent CLI tab to receive the modification', 'error');
          reinjectPicker();
          return;
        }

        const browserUrl = useBrowserTabsStore.getState().getTabState(tabId, label)?.url ?? '';
        const message = formatPickerMessage(data.prompt, data.elements, browserUrl);
        sendToTerminal(projectId, message + '\r', targetTabId);
        // 武装项目级自动刷新：agent 修改文件后刷新本项目的 Browser tab
        armProjectAutoRefresh(projectId);
        reinjectPicker();
      },
      [label, tabId, projectId, showToast, reinjectPicker],
    ),
  );

  // ── 自动刷新：git-changed → 刷新本项目已创建的 Browser tab（武装窗口内） ──
  const refreshRef = useRef(webview.refresh);
  useEffect(() => {
    refreshRef.current = webview.refresh;
  }, [webview.refresh]);

  useTauriEvent<string>(
    GIT_CHANGED_EVENT,
    useCallback(
      (payload) => {
        if (payload !== projectId || !isProjectAutoRefreshArmed(projectId)) return;
        if (isCreatedRef.current) void refreshRef.current();
      },
      [projectId],
    ),
  );

  // ── 自动刷新：file-changed → 本 tab 为 file:// 且变更路径命中时刷新 ──
  useFileChangedEvent((event: FileChangedEvent) => {
    const { project_id, paths } = event;
    if (project_id !== projectId || !isProjectAutoRefreshArmed(projectId)) return;
    if (!paths.length) return;

    const currentUrl = useBrowserTabsStore.getState().getTabState(tabId, label)?.url;
    if (!currentUrl?.startsWith('file://')) return;

    const browserFilePath = fileUrlToFilePath(currentUrl);
    if (!browserFilePath) return;

    const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    const projectRoot = project.path.replace(/\\/g, '/');
    const browserFileNorm = browserFilePath.replace(/\\/g, '/');
    const matched = paths.some((rel: string) => `${projectRoot}/${rel}` === browserFileNorm);

    if (matched) void refreshRef.current();
  });

  // 组件卸载时解除项目武装（避免孤儿定时器）
  useEffect(() => {
    return () => {
      disarmProjectAutoRefresh(projectId);
    };
  }, [projectId]);

  const openExternal = useCallback(async () => {
    const url = browserState?.url;
    if (!url) return;
    try {
      const { openInDefaultBrowser } = await import('../api/browserApi');
      await openInDefaultBrowser(url, projectId);
    } catch (err) {
      console.error('[Browser] Failed to open in external browser:', err);
      showToast('Failed to open in external browser', 'error');
    }
  }, [browserState?.url, projectId, showToast]);

  return {
    label,
    url: browserState?.url ?? '',
    isCreated: browserState?.isCreated ?? false,
    isLoading: browserState?.isLoading ?? false,
    title: browserState?.title ?? '',
    favicon: browserState?.favicon ?? '',
    canGoBack: browserState ? canGoBack(browserState.history) : false,
    canGoForward: browserState ? canGoForward(browserState.history) : false,
    isPicking,
    containerRef,
    navigate: webview.navigate,
    refresh: webview.refresh,
    goBack: webview.goBack,
    goForward: webview.goForward,
    openDevTools: webview.openDevTools,
    openExternal,
    updateBounds: webview.updateBounds,
    startPicker,
    stopPicker,
    reinjectPicker,
  };
}
