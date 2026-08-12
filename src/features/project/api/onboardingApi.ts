import { invoke } from '@tauri-apps/api/core';

export interface ProjectOnboardingState {
  version: number;
  completedSteps: string[];
  dismissed: boolean;
  updatedAt: number;
}

export interface OnboardingConfig {
  projectOnboarding: Record<string, ProjectOnboardingState>;
}

const ONBOARDING_VERSION = 1;

export async function loadOnboardingState(
  projectId: string,
): Promise<ProjectOnboardingState | null> {
  try {
    const config = await invoke<Record<string, unknown>>('load_config');
    const onboarding = (config as unknown as OnboardingConfig).projectOnboarding;
    if (!onboarding) return null;
    return onboarding[projectId] ?? null;
  } catch {
    return null;
  }
}

// Serialize onboarding config writes so that concurrent read-modify-write cycles
// (e.g. two rapid step completions, or completion + dismiss) do not overwrite
// each other's changes.
let saveChain: Promise<void> = Promise.resolve();

export async function saveOnboardingState(
  projectId: string,
  state: Partial<ProjectOnboardingState>,
): Promise<void> {
  const task = saveChain.then(async () => {
    const config = await invoke<Record<string, unknown>>('load_config');
    const raw = (config as unknown as OnboardingConfig).projectOnboarding ?? {};
    const existing = raw[projectId] ?? {
      version: ONBOARDING_VERSION,
      completedSteps: [],
      dismissed: false,
      updatedAt: 0,
    };
    raw[projectId] = {
      ...existing,
      ...state,
      version: ONBOARDING_VERSION,
      updatedAt: Date.now(),
    };
    await invoke<void>('save_config', {
      config: {
        ...config,
        projectOnboarding: raw,
      },
    });
  });
  // Keep the chain moving even if one save fails so that subsequent saves are
  // not permanently blocked. The returned promise still rejects to the caller.
  // 保持链式写入继续推进（否则一次失败永久阻塞后续保存）；
  // 错误仍通过下方 `await task` 抛给调用方，此处仅吞内部链，非静默吞错。
  saveChain = task.catch(() => {});
  await task;
}
