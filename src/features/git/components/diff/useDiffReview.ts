import { useCallback, useMemo, useRef, useState } from 'react';

import { useEditorAgentActions } from '@/shared/hooks/useEditorAgentActions';
import { useEditorStore } from '@/shared/store/editorStore';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { buildDiffMessage } from '@/shared/utils/agentPrompt';

import { capDiffText, hunksToDiffText, hunksToSelectedDiffText } from './diffText';
import type { CommitFileChange, DiffHunk, DiffResult } from './types';

function getProjectIdFromTab(): string | null {
  const tabs = useEditorStore.getState().tabs;
  for (const key of Object.keys(tabs)) {
    return key;
  }
  return null;
}

interface UseDiffReviewParams {
  projectId?: string;
  /** 是否 combined 模式（与 DiffViewProps 一致，可为 undefined）。 */
  combined?: boolean;
  filePath: string;
  diffResult: DiffResult | null;
  fileList: CommitFileChange[];
  selectedLines: Set<string>;
  /** 清空选区（提交成功后 / 关闭 inline 输入条时调用）。 */
  clearSelection: () => void;
}

/**
 * AI Review 逻辑：全文/选区消息组装、agent 终端发送、自定义指令弹层状态、
 * inline 输入条回调，以及供渲染层使用的选择派生 state（选中行数/文件列表/
 * 单文件选区/全局最后选中文件）。
 *
 * 纯逻辑 hook（.ts 文件，不返回 JSX——JSX 组合由 DiffView 完成），
 * 可脱离 Tauri 运行时单独测试。
 */
export function useDiffReview({
  projectId,
  combined,
  filePath,
  diffResult,
  fileList,
  selectedLines,
  clearSelection,
}: UseDiffReviewParams) {
  const { sendToAgent, clearPending } = useEditorAgentActions();
  const currentProjectId = projectId || getProjectIdFromTab() || '';

  // AI review 自定义指令弹层（全文 review，右上角浮层）。
  const [reviewPopover, setReviewPopover] = useState(false);
  // combined 数据提升：FileDiffSection 经 onDiffResult 上报渲染 hunks，review 拼 diff 文本用。
  const hunksByPathRef = useRef<Record<string, DiffHunk[]>>({});

  const reportDiffResult = useCallback((path: string, hunks: DiffHunk[] | null) => {
    const ref = hunksByPathRef.current;
    if (hunks && hunks.length > 0) ref[path] = hunks;
    else delete ref[path];
  }, []);

  /** 文件集变更时清空数据提升缓存（由父级 filesKey effect 调用）。 */
  const clearHunksCache = useCallback(() => {
    hunksByPathRef.current = {};
  }, []);

  const selectedCount = selectedLines.size;

  const selectedFilePaths = useMemo(() => {
    if (!combined) return filePath ? [filePath] : [];
    const paths = new Set<string>();
    for (const key of selectedLines) {
      const sep = key.indexOf('\0');
      if (sep > 0) paths.add(key.slice(0, sep));
    }
    return Array.from(paths);
  }, [combined, selectedLines, filePath]);

  /** 全局最后一个选中行所属文件（combined 模式按 hunk/行号取最大）。 */
  const lastSelectedPath = useMemo(() => {
    if (selectedLines.size === 0) return null;
    let bestPath: string | null = null;
    let bestHunk = -1;
    let bestLine = -1;
    for (const key of selectedLines) {
      const sep = key.indexOf('\0');
      const local = sep >= 0 ? key.slice(sep + 1) : key;
      const [h, l] = local.split(':').map(Number);
      if (h > bestHunk || (h === bestHunk && l > bestLine)) {
        bestHunk = h;
        bestLine = l;
        bestPath = sep >= 0 ? key.slice(0, sep) : null;
      }
    }
    return bestPath;
  }, [selectedLines]);

  const selectedLinesForPath = useCallback(
    (path: string) => {
      const prefix = `${path}\0`;
      const out = new Set<string>();
      for (const key of selectedLines) {
        if (key.startsWith(prefix)) out.add(key.slice(prefix.length));
      }
      return out;
    },
    [selectedLines],
  );

  const notifyNoAgentTerminal = useCallback(() => {
    useNotificationStore.getState().addNotification({
      type: 'warning',
      title: 'No agent terminal open',
      message: 'Open an agent terminal, then try Review again.',
    });
  }, []);

  const sendReview = useCallback(
    (message: string, clearOnSuccess: boolean) => {
      const sent = sendToAgent(currentProjectId, message);
      if (sent) {
        if (clearOnSuccess) clearSelection();
        return;
      }
      notifyNoAgentTerminal();
      clearPending();
    },
    [currentProjectId, sendToAgent, clearSelection, notifyNoAgentTerminal, clearPending],
  );

  const handleReviewFull = useCallback(() => {
    setReviewPopover(true);
  }, []);

  /** combined 模式：把已展开文件的渲染 hunks 拼成带行号的 diff 文本。 */
  const combinedDiffText = useCallback((paths?: string[]): string => {
    const ref = hunksByPathRef.current;
    const targetPaths = paths && paths.length > 0 ? paths : Object.keys(ref);
    const sections: string[] = [];
    for (const p of targetPaths) {
      const hunks = ref[p];
      if (hunks && hunks.length > 0) {
        sections.push(`## file: ${p}\n${hunksToDiffText(hunks)}`);
      }
    }
    return sections.join('\n\n');
  }, []);

  /** combined 模式：把选中文件的选中行拼成带行号的 diff 文本。 */
  const combinedSelectedDiffText = useCallback((): string => {
    const ref = hunksByPathRef.current;
    const sections: string[] = [];
    for (const p of selectedFilePaths) {
      const hunks = ref[p];
      if (hunks && hunks.length > 0) {
        const text = hunksToSelectedDiffText(hunks, selectedLinesForPath(p));
        if (text) sections.push(`## file: ${p}\n${text}`);
      }
    }
    return sections.join('\n\n');
  }, [selectedFilePaths, selectedLinesForPath]);

  /** 提交选区 review（从 inline 输入条）。 */
  const submitSelectionReview = useCallback(
    (instruction?: string) => {
      const message = combined
        ? buildDiffMessage('review', {
            filePath: 'combined',
            lineCount: selectedCount,
            combined: true,
            fileCount: selectedFilePaths.length,
            filePaths: selectedFilePaths,
            instruction,
            diffText: capDiffText(combinedSelectedDiffText()),
          })
        : buildDiffMessage('review', {
            filePath,
            lineCount: selectedCount,
            instruction,
            diffText: capDiffText(hunksToSelectedDiffText(diffResult?.hunks ?? [], selectedLines)),
          });
      sendReview(message, true);
    },
    [
      combined,
      filePath,
      diffResult,
      selectedCount,
      selectedFilePaths,
      combinedSelectedDiffText,
      selectedLines,
      sendReview,
    ],
  );

  /** 提交全文 review：组装消息 → 发送到 agent 终端。 */
  const submitFullReview = useCallback(
    (instruction?: string) => {
      setReviewPopover(false);
      const message = combined
        ? buildDiffMessage('review', {
            filePath: 'combined',
            isFullDiff: true,
            combined: true,
            fileCount: fileList.length,
            instruction,
            diffText: capDiffText(combinedDiffText()),
          })
        : buildDiffMessage('review', {
            filePath,
            isFullDiff: true,
            instruction,
            diffText: capDiffText(hunksToDiffText(diffResult?.hunks ?? [])),
          });
      sendReview(message, false);
    },
    [combined, fileList.length, filePath, diffResult, combinedDiffText, sendReview],
  );

  return {
    reviewPopover,
    setReviewPopover,
    selectedCount,
    handleReviewFull,
    submitSelectionReview,
    submitFullReview,
    reportDiffResult,
    clearHunksCache,
    selectedLinesForPath,
    lastSelectedPath,
  };
}
