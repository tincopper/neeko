import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadOnboardingState, saveOnboardingState } from '../../api/onboardingApi';
import { useProjectOnboarding } from '../useProjectOnboarding';

vi.mock('../../api/onboardingApi', () => ({
  loadOnboardingState: vi.fn(),
  saveOnboardingState: vi.fn(),
}));

const mockLoad = vi.mocked(loadOnboardingState);
const mockSave = vi.mocked(saveOnboardingState);

describe('useProjectOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
  });

  it('should_load_state_on_mount', async () => {
    mockLoad.mockResolvedValue({
      version: 1,
      completedSteps: ['terminal'],
      dismissed: false,
      updatedAt: 123,
    });
    const { result } = renderHook(() => useProjectOnboarding('p1'));
    await waitFor(() => {
      expect(result.current.state?.completedSteps).toEqual(['terminal']);
    });
    expect(mockLoad).toHaveBeenCalledWith('p1');
  });

  it('should_start_with_null_state', () => {
    const { result } = renderHook(() => useProjectOnboarding('p1'));
    expect(result.current.state).toBeNull();
  });

  it('should_mark_step_complete', async () => {
    const { result } = renderHook(() => useProjectOnboarding('p1'));
    await waitFor(() => {
      expect(result.current.state).toBeNull();
    });
    await act(async () => {
      await result.current.markStepComplete('terminal');
    });
    expect(result.current.state?.completedSteps).toEqual(['terminal']);
    expect(mockSave).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ completedSteps: ['terminal'] }),
    );
  });

  it('should_not_duplicate_completed_steps', async () => {
    mockLoad.mockResolvedValue({
      version: 1,
      completedSteps: ['terminal'],
      dismissed: false,
      updatedAt: 0,
    });
    const { result } = renderHook(() => useProjectOnboarding('p1'));
    await waitFor(() => {
      expect(result.current.state?.completedSteps).toEqual(['terminal']);
    });
    await act(async () => {
      await result.current.markStepComplete('terminal');
    });
    expect(result.current.state?.completedSteps).toEqual(['terminal']);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('should_dismiss_onboarding', async () => {
    const { result } = renderHook(() => useProjectOnboarding('p1'));
    await act(async () => {
      await result.current.dismissOnboarding();
    });
    expect(result.current.state?.dismissed).toBe(true);
    expect(mockSave).toHaveBeenCalledWith('p1', expect.objectContaining({ dismissed: true }));
  });

  it('should_undismiss_onboarding', async () => {
    mockLoad.mockResolvedValue({
      version: 1,
      completedSteps: [],
      dismissed: true,
      updatedAt: 0,
    });
    const { result } = renderHook(() => useProjectOnboarding('p1'));
    await waitFor(() => {
      expect(result.current.state?.dismissed).toBe(true);
    });
    await act(async () => {
      await result.current.undismissOnboarding();
    });
    expect(result.current.state?.dismissed).toBe(false);
  });

  it('should_include_worktree_path_in_key', async () => {
    renderHook(() => useProjectOnboarding('p1', '/wt/feature'));
    await waitFor(() => {
      expect(mockLoad).toHaveBeenCalledWith('p1::/wt/feature');
    });
  });

  it('should_not_load_when_project_id_is_null', () => {
    renderHook(() => useProjectOnboarding(null));
    expect(mockLoad).not.toHaveBeenCalled();
  });
});
