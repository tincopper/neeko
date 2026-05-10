import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommitDetail, CommitFileChange } from "../../types";
import type { CommitDetailData } from "./types";

export function useCommitDetail(
  projectId: string | null,
  commitHash: string | null,
): CommitDetailData {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [files, setFiles] = useState<CommitFileChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastHashRef = useRef<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!projectId || !commitHash) return;
    setLoading(true);
    setError(null);
    try {
      const [detailResult, filesResult] = await Promise.all([
        invoke<CommitDetail>("get_commit_detail_command", {
          projectId,
          commitHash,
        }),
        invoke<CommitFileChange[]>("get_commit_files_command", {
          projectId,
          commitHash,
        }),
      ]);
      setDetail(detailResult);
      setFiles(filesResult);
    } catch (err) {
      setError(err as string);
    } finally {
      setLoading(false);
    }
  }, [projectId, commitHash]);

  useEffect(() => {
    if (!commitHash) {
      setDetail(null);
      setFiles([]);
      lastHashRef.current = null;
      return;
    }
    if (commitHash === lastHashRef.current) return;
    lastHashRef.current = commitHash;
    void loadDetail();
  }, [commitHash, loadDetail]);

  return { detail, files, loading, error };
}
