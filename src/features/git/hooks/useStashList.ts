import { useCallback, useEffect, useRef, useState } from 'react';

import type { CommitFileChange, StashActionResult, StashEntry } from '@/features/git/types';
import type { ProjectCommands } from '@/shared/types/activeProject';

export interface StashListData {
  stashes: StashEntry[];
  loading: boolean;
  error: string | null;
  expandedSelector: string | null;
  expandedFiles: CommitFileChange[];
  filesLoading: boolean;
  filesError: string | null;
  toggleExpand: (selector: string) => Promise<void>;
  // apply / pop 操作
  actionLoading: boolean;
  applyStash: (selector: string) => Promise<StashActionResult | null>;
  popStash: (selector: string) => Promise<StashActionResult | null>;
}

/** 加载 git stash 列表；点击某条展开其文件变更，支持 apply/pop。点击文件在编辑器打开 diff tab。 */
export function useStashList(commands: ProjectCommands | null): StashListData {
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSelector, setExpandedSelector] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<CommitFileChange[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // apply/pop 状态
  const [actionLoading, setActionLoading] = useState(false);

  // 列表加载序号：commands 切换时递增，使旧项目的慢响应过期（防止覆盖新项目数据）
  const loadSeq = useRef(0);
  const loadStashes = useCallback(async () => {
    if (!commands) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await commands.getStashList();
      if (seq !== loadSeq.current) return;
      setStashes(list);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err as string);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [commands]);

  // commands 切换时清空旧列表并重新加载（面板挂载即加载，供 tab 徽章计数）
  useEffect(() => {
    if (!commands) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部 commands 变化时同步重置本地列表（项目既有模式）
    setStashes([]);
    void loadStashes();
  }, [commands, loadStashes]);

  // 展开/收起都会递增序号，使更早的 getStashFiles 响应过期（防止慢响应覆盖新选择）
  const requestSeq = useRef(0);

  const toggleExpand = useCallback(
    async (selector: string) => {
      if (!commands) return;
      const seq = ++requestSeq.current;
      if (expandedSelector === selector) {
        setExpandedSelector(null);
        setExpandedFiles([]);
        setFilesError(null);
        return;
      }
      setExpandedSelector(selector);
      setExpandedFiles([]);
      setFilesError(null);
      setFilesLoading(true);
      try {
        const files = await commands.getStashFiles(selector);
        if (seq !== requestSeq.current) return;
        setExpandedFiles(files);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setFilesError(err as string);
      } finally {
        if (seq === requestSeq.current) setFilesLoading(false);
      }
    },
    [commands, expandedSelector],
  );

  // apply/pop 互斥守卫：ref 同步判断，防止 state 异步更新期间并发操作
  const actionBusy = useRef(false);

  const runAction = useCallback(
    async (
      selector: string,
      run: (sel: string) => Promise<StashActionResult>,
    ): Promise<StashActionResult | null> => {
      if (actionBusy.current) return null;
      actionBusy.current = true;
      setActionLoading(true);
      try {
        return await run(selector);
      } catch (err) {
        return { success: false, message: String(err) };
      } finally {
        actionBusy.current = false;
        setActionLoading(false);
      }
    },
    [],
  );

  const applyStash = useCallback(
    async (selector: string) => {
      if (!commands) return null;
      return runAction(selector, (sel) => commands.stashApply(sel));
    },
    [commands, runAction],
  );

  const popStash = useCallback(
    async (selector: string) => {
      if (!commands) return null;
      return runAction(selector, async (sel) => {
        const result = await commands.stashPop(sel);
        if (result.success) {
          // pop 会移除条目：刷新列表
          void loadStashes();
        }
        return result;
      });
    },
    [commands, runAction, loadStashes],
  );

  return {
    stashes,
    loading,
    error,
    expandedSelector,
    expandedFiles,
    filesLoading,
    filesError,
    toggleExpand,
    actionLoading,
    applyStash,
    popStash,
  };
}
