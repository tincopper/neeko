import { useRef } from "react";
import type { WorktreeItem } from "./useWorktreeState";

export type SetterRef<T> = React.MutableRefObject<T | null>;
export type DiffSetter = SetterRef<(s: any) => void>;
export type BranchSetter = SetterRef<(b: string) => void>;
export type OpenedWtSetter = SetterRef<(u: WorktreeItem[] | ((p: WorktreeItem[]) => WorktreeItem[])) => void>;
export type WorktreePathSetter = SetterRef<(p: string | null) => void>;

export interface CrossDomainRefs {
  // WSL → Remote
  setRemoteDiffStateRef: DiffSetter;
  remoteActiveWtBranchSetterRef: BranchSetter;
  remoteOpenedWtSetterRef: OpenedWtSetter;
  remoteWorktreePathSetterRef: WorktreePathSetter;
  // Remote → WSL
  setWslDiffStateRef: DiffSetter;
  wslActiveWtBranchSetterRef: BranchSetter;
  wslOpenedWtSetterRef: OpenedWtSetter;
  wslWorktreePathSetterRef: WorktreePathSetter;
}

export function useCrossDomainRefs(): CrossDomainRefs {
  const setRemoteDiffStateRef = useRef<((s: any) => void) | null>(null);
  const remoteActiveWtBranchSetterRef = useRef<((b: string) => void) | null>(null);
  const remoteOpenedWtSetterRef = useRef<((u: WorktreeItem[] | ((p: WorktreeItem[]) => WorktreeItem[])) => void) | null>(null);
  const remoteWorktreePathSetterRef = useRef<((p: string | null) => void) | null>(null);
  const setWslDiffStateRef = useRef<((s: any) => void) | null>(null);
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
