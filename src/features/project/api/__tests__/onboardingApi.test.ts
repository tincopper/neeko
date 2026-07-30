import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { loadOnboardingState, saveOnboardingState } from '../onboardingApi';

describe('onboardingApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadOnboardingState', () => {
    it('should_return_state_when_exists', async () => {
      mockInvoke.mockResolvedValue({
        projectOnboarding: {
          p1: { version: 1, completedSteps: ['terminal'], dismissed: false, updatedAt: 123 },
        },
      });
      const state = await loadOnboardingState('p1');
      expect(state).toEqual({
        version: 1,
        completedSteps: ['terminal'],
        dismissed: false,
        updatedAt: 123,
      });
      expect(mockInvoke).toHaveBeenCalledWith('load_config');
    });

    it('should_return_null_when_no_onboarding', async () => {
      mockInvoke.mockResolvedValue({});
      const state = await loadOnboardingState('p1');
      expect(state).toBeNull();
    });

    it('should_return_null_when_project_not_found', async () => {
      mockInvoke.mockResolvedValue({
        projectOnboarding: {
          p2: { version: 1, completedSteps: [], dismissed: false, updatedAt: 0 },
        },
      });
      const state = await loadOnboardingState('p1');
      expect(state).toBeNull();
    });

    it('should_return_null_on_error', async () => {
      mockInvoke.mockRejectedValue(new Error('config error'));
      const state = await loadOnboardingState('p1');
      expect(state).toBeNull();
    });
  });

  describe('saveOnboardingState', () => {
    it('should_save_state', async () => {
      mockInvoke.mockResolvedValue({ projectOnboarding: {} });
      await saveOnboardingState('p1', { completedSteps: ['terminal'] });
      expect(mockInvoke).toHaveBeenCalledWith('save_config', {
        config: expect.objectContaining({
          projectOnboarding: {
            p1: expect.objectContaining({ completedSteps: ['terminal'], version: 1 }),
          },
        }),
      });
    });

    it('should_merge_with_existing_state', async () => {
      mockInvoke.mockResolvedValue({ projectOnboarding: {} });
      await saveOnboardingState('p1', { completedSteps: ['terminal'] });
      await saveOnboardingState('p1', { completedSteps: ['terminal', 'agent'] });
      const lastCall = mockInvoke.mock.calls[mockInvoke.mock.calls.length - 1];
      expect(lastCall[1]).toEqual(
        expect.objectContaining({
          config: expect.objectContaining({
            projectOnboarding: {
              p1: expect.objectContaining({ completedSteps: ['terminal', 'agent'] }),
            },
          }),
        }),
      );
    });
  });
});
