import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppContext } from '@/shared/contexts';
import type { FileChange } from '@/shared/types';
import type {
  ProjectCommands,
  ProjectCapabilities,
  ProjectView,
} from '@/shared/types/activeProject';
import { reportFrontendError } from '@/shared/utils/errorReporting';

/** diff stats 与 changed files 的合并视图。 */
export type ChangedFilesWithStats = Array<FileChange & { additions: number; deletions: number }>;

interface UseCommitPanelDiffStatsParams {
  commands: ProjectCommands;
  projectId: string;
  changedFiles: FileChange[];
}

/**
 * Changed files 的 +/- 统计懒加载：首渲染后异步拉取、清空时复位、
 * 合并为带统计的文件列表。
 */
export function useCommitPanelDiffStats({
  commands,
  projectId,
  changedFiles,
}: UseCommitPanelDiffStatsParams) {
  const [diffStats, setDiffStats] = useState<
    Record<string, { additions: number; deletions: number }>
  >({});
  const prevHasChangesRef = useRef(changedFiles.length > 0);

  useEffect(() => {
    if (changedFiles.length === 0 && prevHasChangesRef.current) {
      prevHasChangesRef.current = false;
      setDiffStats({});
    } else if (changedFiles.length > 0) {
      prevHasChangesRef.current = true;
    }
  }, [changedFiles]);

  useEffect(() => {
    if (changedFiles.length === 0) return;
    let cancelled = false;
    commands
      .getChangedFilesDiffStats()
      .then((stats) => {
        if (cancelled) return;
        const map: Record<string, { additions: number; deletions: number }> = {};
        for (const s of stats) {
          map[s.path] = { additions: s.additions, deletions: s.deletions };
        }
        setDiffStats(map);
      })
      .catch((err) => reportFrontendError('git.diffStats', err));
    return () => {
      cancelled = true;
    };
  }, [projectId, changedFiles.length, commands]);

  const changedFilesWithStats: ChangedFilesWithStats = changedFiles.map((f) => ({
    ...f,
    additions: diffStats[f.path]?.additions ?? f.additions,
    deletions: diffStats[f.path]?.deletions ?? f.deletions,
  }));

  return { changedFilesWithStats };
}

interface UseDividerDragParams {
  /** 初始 commit textarea 高度。 */
  initialHeight?: number;
}

/**
 * Commit 区可拖拽分隔条：textarea 高度状态 + mousedown 拖拽编排，
 * 含卸载时 body 样式复位守卫（防 userSelect/cursor 泄漏）。
 */
export function useDividerDrag({ initialHeight = 120 }: UseDividerDragParams = {}) {
  const [textareaHeight, setTextareaHeight] = useState(initialHeight);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { startY: e.clientY, startHeight: textareaHeight };

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragStartRef.current) return;
        const delta = dragStartRef.current.startY - ev.clientY;
        const newHeight = Math.max(40, Math.min(300, dragStartRef.current.startHeight + delta));
        setTextareaHeight(newHeight);
      };

      const onMouseUp = () => {
        dragStartRef.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [textareaHeight],
  );

  // Guard against userSelect/cursor leak: if this component unmounts while a
  // divider drag is still in progress the document-level mouseup handler will
  // never fire, leaving body styles permanently dirty.
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  return { textareaHeight, handleDividerMouseDown };
}

interface UseAiCommitMessageParams {
  commands: ProjectCommands;
  capabilities: ProjectCapabilities;
  project: ProjectView;
  selectedFiles: ReadonlySet<string>;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onGenerated: (message: string) => void;
}

/** AI 生成 commit message（状态 + 编排），按钮可用性一并输出。 */
export function useAiCommitMessage({
  commands,
  capabilities,
  project,
  selectedFiles,
  onShowToast,
  onGenerated,
}: UseAiCommitMessageParams) {
  const [aiGenerating, setAiGenerating] = useState(false);
  const { config } = useAppContext();

  // AI 按钮仅当 capabilities.canGenerateCommitMessage 且已选择 agent 时可用
  const canAiGenerate = capabilities.canGenerateCommitMessage && !!project.selectedAgent;

  const handleAiGenerate = useCallback(async () => {
    if (!capabilities.canGenerateCommitMessage || !project.selectedAgent) return;
    const files = Array.from(selectedFiles);
    if (files.length === 0) {
      onShowToast?.('No files selected. Please select files to generate commit message.', 'error');
      return;
    }
    setAiGenerating(true);
    try {
      const selectedAgent = project.selectedAgent?.[0] ?? '';
      const agentCommandOverride = config.agentCommandOverrides?.[selectedAgent] ?? null;
      const generated = await commands.generateCommitMessage(
        selectedAgent,
        files,
        agentCommandOverride,
      );
      onGenerated(generated.trim());
    } catch (e: unknown) {
      onShowToast?.(String(e), 'error');
    } finally {
      setAiGenerating(false);
    }
  }, [
    capabilities.canGenerateCommitMessage,
    project.selectedAgent,
    selectedFiles,
    commands,
    config.agentCommandOverrides,
    onShowToast,
    onGenerated,
  ]);

  return { aiGenerating, canAiGenerate, handleAiGenerate };
}
