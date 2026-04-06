import { useRef } from "react";
import type { AuthMethod } from "../types";
import type { WorktreeItem } from "./useWorktreeState";

export type SetterRef<T> = React.MutableRefObject<T | null>;
export type RemoteDiffState = { entryId: string; host: string; port: number; username: string; auth: AuthMethod; projectPath: string; filePath: string };
export type WslDiffState = { distro: string; projectPath: string; filePath: string };
export type DiffSetter<T> = SetterRef<(s: T | null) => void>;
export type BranchSetter = SetterRef<(b: string) => void>;
export type OpenedWtSetter = SetterRef<(u: WorktreeItem[] | ((p: WorktreeItem[]) => WorktreeItem[])) => void>;
export type WorktreePathSetter = SetterRef<(p: string | null) => void>;

export interface CrossDomainRefs {
  // WSL → Remote
  setRemoteDiffStateRef: DiffSetter<RemoteDiffState>;
  remoteActiveWtBranchSetterRef: BranchSetter;
  remoteOpenedWtSetterRef: OpenedWtSetter;
  remoteWorktreePathSetterRef: WorktreePathSetter;
  // Remote → WSL
  setWslDiffStateRef: DiffSetter<WslDiffState>;
  wslActiveWtBranchSetterRef: BranchSetter;
  wslOpenedWtSetterRef: OpenedWtSetter;
  wslWorktreePathSetterRef: WorktreePathSetter;
}

export function useCrossDomainRefs(): CrossDomainRefs {
  const setRemoteDiffStateRef = useRef<((s: RemoteDiffState | null) => void) | null>(null);
  const remoteActiveWtBranchSetterRef = useRef<((b: string) => void) | null>(null);
  const remoteOpenedWtSetterRef = useRef<((u: WorktreeItem[] | ((p: WorktreeItem[]) => WorktreeItem[])) => void) | null>(null);
  const remoteWorktreePathSetterRef = useRef<((p: string | null) => void) | null>(null);
  const setWslDiffStateRef = useRef<((s: WslDiffState | null) => void) | null>(null);
  const wslActiveWtBranchSetterRef = useRef<((b: string) => void) | null>(null);
  const wslOpenedWtSetterRef = useRef<((u: WorktreeItem[] | ((p: WorktreeItem[]) => WorktreeItem[])) => void) | null>(null);
  const wslWorktreePathSetterRef = useRef<((p: string | null) => void) | null>(null);

  return {
    setRemoteDiffStateRef, remoteActiveWtBranchSetterRef,
    remoteOpenedWtSetterRef, remoteWorktreePathSetterRef,
    setWslDiffStateRef, wslActiveWtBranchSetterRef,
    wslOpenedWtSetterRef, wslWorktreePathSetterRef,
  };
}
