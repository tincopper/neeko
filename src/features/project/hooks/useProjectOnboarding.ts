import { useState, useEffect, useCallback, useRef } from 'react';

import {
  loadOnboardingState,
  saveOnboardingState,
  type ProjectOnboardingState,
} from '../api/onboardingApi';

function buildKey(projectId: string, worktreePath?: string | null): string {
  return worktreePath ? `${projectId}::${worktreePath}` : projectId;
}

function buildDefaultState(): ProjectOnboardingState {
  return {
    version: 1,
    completedSteps: [],
    dismissed: false,
    updatedAt: 0,
  };
}

export function useProjectOnboarding(projectId: string | null, worktreePath?: string | null) {
  const [state, setState] = useState<ProjectOnboardingState | null>(null);
  const keyRef = useRef<string | null>(null);
  const stateRef = useRef<ProjectOnboardingState | null>(null);
  const ignoreLoadRef = useRef(0);

  // Keep a synchronous view of the latest state for mutation callbacks.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!projectId) {
      keyRef.current = null;
      return;
    }
    const key = buildKey(projectId, worktreePath);
    keyRef.current = key;
    let cancelled = false;
    const loadTicket = ignoreLoadRef.current;
    void loadOnboardingState(key).then((loaded) => {
      if (!cancelled && keyRef.current === key && ignoreLoadRef.current === loadTicket) {
        setState(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, worktreePath]);

  const markStepComplete = useCallback(
    async (stepId: string) => {
      if (!projectId) return;
      const key = buildKey(projectId, worktreePath);
      const existing = stateRef.current ?? buildDefaultState();
      if (existing.completedSteps.includes(stepId)) return;
      const next: ProjectOnboardingState = {
        ...existing,
        completedSteps: [...existing.completedSteps, stepId],
        updatedAt: Date.now(),
      };
      setState(next);
      stateRef.current = next;
      ignoreLoadRef.current += 1;
      await saveOnboardingState(key, {
        completedSteps: next.completedSteps,
        updatedAt: next.updatedAt,
      });
    },
    [projectId, worktreePath],
  );

  const dismissOnboarding = useCallback(async () => {
    if (!projectId) return;
    const key = buildKey(projectId, worktreePath);
    const base = stateRef.current ?? buildDefaultState();
    const next: ProjectOnboardingState = {
      ...base,
      dismissed: true,
      updatedAt: Date.now(),
    };
    setState(next);
    stateRef.current = next;
    ignoreLoadRef.current += 1;
    await saveOnboardingState(key, {
      dismissed: true,
      updatedAt: next.updatedAt,
    });
  }, [projectId, worktreePath]);

  const undismissOnboarding = useCallback(async () => {
    if (!projectId) return;
    const key = buildKey(projectId, worktreePath);
    const base = stateRef.current ?? buildDefaultState();
    const next: ProjectOnboardingState = {
      ...base,
      dismissed: false,
      updatedAt: Date.now(),
    };
    setState(next);
    stateRef.current = next;
    ignoreLoadRef.current += 1;
    await saveOnboardingState(key, {
      dismissed: false,
      updatedAt: next.updatedAt,
    });
  }, [projectId, worktreePath]);

  return { state, markStepComplete, dismissOnboarding, undismissOnboarding };
}
