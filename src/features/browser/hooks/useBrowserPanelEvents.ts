import { useCallback, useEffect, useRef } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- browser panel sends terminal commands via terminal feature
import { sendToTerminal } from '@/features/terminal';
import {
  BROWSER_OPEN_URL_EVENT,
  BROWSER_PAGE_LOADED_EVENT,
  BROWSER_PAGE_META_EVENT,
  BROWSER_PROMPT_SUBMITTED_EVENT,
  BROWSER_URL_CHANGED_EVENT,
  GIT_CHANGED_EVENT,
} from '@/shared/events';
import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
import { useTauriEvent } from '@/shared/hooks/useTauriEvent';
import { useProjectBrowserStore, type BrowserPanelState } from '@/shared/store/browserStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChangedEvent } from '@/shared/types';
import { fileUrlToFilePath } from '@/shared/utils/browserUtils';
import { recordNavigation } from '@/shared/utils/historyStack';

import { browserNavigate } from '../api/browserApi';
import { isAgentCliTab, formatPickerMessage, type PickerElement } from '../components/pickerUtils';

import { getProjectBrowserLabel } from './useBrowserConstants';

/** Payload emitted by Rust when user submits prompt from injected input */
interface PromptSubmittedPayload {
  prompt: string;
  /** 选中元素（单选长度 1，多选长度 N）。 */
  elements: PickerElement[];
  /** 提交方 webview 的 label（新版注入脚本携带；缺失时回退到当前项目路由）。 */
  label?: string;
}

interface UseBrowserPanelEventsParams {
  activeProjectId: string | null;
  label: string | null;
  isCreatedRef: React.RefObject<boolean>;
  /** auto-refresh 武装标记（armAutoRefresh/disarmAutoRefresh 操作同一 ref） */
  pendingRefreshTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  refreshRef: React.RefObject<() => Promise<void>>;
  navigateRef: React.RefObject<(url: string) => Promise<void>>;
  disarmLoadingTimeout: () => void;
  armAutoRefresh: () => void;
  reinjectPicker: () => void;
  showToast: (message: string, type?: 'info' | 'error') => void;
}

/**
 * 浏览器面板外部输入监听层：Tauri 事件 / 文件变更 / store 外部导航命令。
 *
 * 只做「监听 → 更新状态或触发行为」，不持有 webview 生命周期；
 * 行为回调由 useBrowserPanel 注入（单向数据流）。
 */
export function useBrowserPanelEvents({
  activeProjectId,
  label,
  isCreatedRef,
  pendingRefreshTimerRef,
  refreshRef,
  navigateRef,
  disarmLoadingTimeout,
  armAutoRefresh,
  reinjectPicker,
  showToast,
}: UseBrowserPanelEventsParams): void {
  const setBrowserState = useProjectBrowserStore((s) => s.setPanelState);

  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  // Listen: URL changed (navigation started) — sync address bar + history stack
  useTauriEvent<{ label: string; url: string }>(
    BROWSER_URL_CHANGED_EVENT,
    useCallback(
      ({ label: eventLabel, url }) => {
        if (!activeProjectId) return;
        if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
        const prevState = useProjectBrowserStore.getState().getPanelState(activeProjectId);
        setBrowserState(activeProjectId, {
          url,
          isLoading: true,
          history: recordNavigation(prevState.history, url),
        });
      },
      [activeProjectId, setBrowserState],
    ),
  );

  // Listen: page meta (title/favicon) — surface in address bar
  useTauriEvent<{ label: string; title: string; favicon: string }>(
    BROWSER_PAGE_META_EVENT,
    useCallback(
      ({ label: eventLabel, title, favicon }) => {
        if (!activeProjectId) return;
        if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
        setBrowserState(activeProjectId, { title, favicon });
      },
      [activeProjectId, setBrowserState],
    ),
  );

  // Listen: page fully loaded — stop loading indicator
  useTauriEvent<{ label: string; url: string }>(
    BROWSER_PAGE_LOADED_EVENT,
    useCallback(
      ({ label: eventLabel, url }) => {
        if (!activeProjectId) return;
        if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
        disarmLoadingTimeout();
        setBrowserState(activeProjectId, { url, isLoading: false });
      },
      [activeProjectId, setBrowserState, disarmLoadingTimeout],
    ),
  );

  // Listen: target="_blank" link — navigate in current webview
  useTauriEvent<{ label: string; url: string }>(
    BROWSER_OPEN_URL_EVENT,
    useCallback(
      ({ label: eventLabel, url: eventUrl }) => {
        if (!activeProjectId) return;
        if (eventLabel !== getProjectBrowserLabel(activeProjectId)) return;
        if (isCreatedRef.current && label) {
          browserNavigate(label, eventUrl).catch((err) => {
            console.error('[Browser] Failed to open new-window url:', err);
          });
          setBrowserState(activeProjectId, { url: eventUrl });
        }
      },
      [activeProjectId, setBrowserState, label, isCreatedRef],
    ),
  );

  // Listen: prompt submitted from injected input inside browser webview
  useTauriEvent<PromptSubmittedPayload>(
    BROWSER_PROMPT_SUBMITTED_EVENT,
    useCallback(
      (payload) => {
        const data: PromptSubmittedPayload =
          typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (!data?.prompt || !Array.isArray(data.elements) || data.elements.length === 0) return;
        // label 过滤：带 label 且不是本 panel 的 webview → 由对应 tab 处理；缺失(旧版)回退。
        if (data.label && data.label !== label) return;

        const projectState = useProjectStore.getState();
        const editorState = useEditorStore.getState();
        const projectId = projectState.activeProjectId;
        if (!projectId) {
          reinjectPicker();
          return;
        }
        const projectTabs = editorState.tabs[projectId];
        if (!isAgentCliTab(projectTabs, editorState.activeTabId)) {
          showToastRef.current('Please switch to an Agent CLI tab', 'error');
          reinjectPicker();
          return;
        }

        const browserUrl = useProjectBrowserStore.getState().getPanelState(projectId)?.url ?? '';
        const message = formatPickerMessage(data.prompt, data.elements, browserUrl);
        sendToTerminal(projectId, message + '\r', editorState.activeTabId);
        armAutoRefresh();
        reinjectPicker();
      },
      [reinjectPicker, label, armAutoRefresh],
    ),
  );

  // Listen: git-changed — auto-refresh browser when armed
  useTauriEvent<string>(
    GIT_CHANGED_EVENT,
    useCallback(
      (payload) => {
        if (pendingRefreshTimerRef.current === null) return;
        const currentProjectId = useProjectStore.getState().activeProjectId;
        if (payload !== currentProjectId) return;
        void refreshRef.current?.();
      },
      [pendingRefreshTimerRef, refreshRef],
    ),
  );

  // Listen: file-changed — auto-refresh browser when it has a file:// URL that matches
  useFileChangedEvent((event: FileChangedEvent) => {
    const { project_id, paths } = event;
    if (!paths.length) return;

    const currentUrl = useProjectBrowserStore.getState().getPanelState(project_id)?.url;
    if (!currentUrl?.startsWith('file://')) return;

    const browserFilePath = fileUrlToFilePath(currentUrl);
    if (!browserFilePath) return;

    const state = useProjectStore.getState();
    const project = state.projects.find((p) => p.id === project_id);
    if (!project) return;

    const projectRoot = project.path.replace(/\\/g, '/');
    const browserFileNorm = browserFilePath.replace(/\\/g, '/');
    const matched = paths.some((rel: string) => {
      const abs = `${projectRoot}/${rel}`;
      return abs === browserFileNorm;
    });

    if (matched) {
      void refreshRef.current?.();
    }
  });

  // Listen for external navigateTo() calls when the panel is already mounted
  useEffect(() => {
    const unsubscribe = useProjectBrowserStore.subscribe((state, prev) => {
      if (!activeProjectId) return;
      const current: BrowserPanelState | undefined = state.states[activeProjectId];
      const previous: BrowserPanelState | undefined = prev.states[activeProjectId];
      if (current && previous && current.url && current.isLoading && current.url !== previous.url) {
        void navigateRef.current?.(current.url);
      }
    });
    return () => unsubscribe();
  }, [activeProjectId, navigateRef]);
}
