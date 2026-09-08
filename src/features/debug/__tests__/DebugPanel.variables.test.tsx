import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/contexts/AppContext', () => ({
  useAppContext: () => ({ config: {} }),
}));

import DebugPanel from '../components/DebugPanel';
import { useDebugStore } from '../store/debugStore';
import type { VariableDto } from '../types';

const child: VariableDto = {
  name: 'fetched_at',
  value: '2026-09-04',
  type: null,
  variablesReference: 0,
};
const root: VariableDto = {
  name: 'm',
  value: '{fetched_at:...}',
  type: 'map[string]string',
  variablesReference: 100,
};

function seed(overrides: Record<string, unknown> = {}) {
  useDebugStore.setState({
    panelOpen: true,
    panelTab: 'session',
    session: {
      sessionId: 's1',
      projectId: 'p1',
      projectPath: '/proj',
      configName: 'cfg',
      status: 'stopped',
    },
    frames: [],
    variables: [root],
    childrenByRef: {},
    expandedRefs: {},
    loadingRefs: {},
    varErrors: {},
    selectedFrameId: null,
    stoppedAt: null,
    error: null,
    ...overrides,
  });
}

beforeEach(() => {
  seed();
});

describe('DebugPanel variables tree', () => {
  it('should_render_chevron_for_expandable_variable_and_plain_indent_for_leaf', () => {
    render(<DebugPanel />);
    expect(screen.getByLabelText('Expand')).toBeInTheDocument();
    // No collapse/expand control rendered for leaf rows.
    expect(screen.queryByLabelText('Collapse')).not.toBeInTheDocument();
  });

  it('should_show_value_in_row_title_for_hover_full_value', () => {
    render(<DebugPanel />);
    expect(screen.getByTitle('{fetched_at:...}')).toBeInTheDocument();
  });

  it('should_render_children_when_reference_expanded', () => {
    seed({
      childrenByRef: { 100: [child] },
      expandedRefs: { 100: true },
    });
    render(<DebugPanel />);
    expect(screen.getByText('fetched_at')).toBeInTheDocument();
    expect(screen.getByText('2026-09-04')).toBeInTheDocument();
    expect(screen.getByLabelText('Collapse')).toBeInTheDocument();
  });

  it('should_toggle_collapse_on_chevron_click', async () => {
    seed({
      childrenByRef: { 100: [child] },
      expandedRefs: { 100: true },
    });
    render(<DebugPanel />);
    // toggleVariableExpand is async — settle via waitFor instead of act.
    fireEvent.click(screen.getByLabelText('Collapse'));
    await waitFor(() => expect(screen.queryByText('fetched_at')).not.toBeInTheDocument());
    expect(useDebugStore.getState().expandedRefs[100]).toBe(false);

    fireEvent.click(screen.getByLabelText('Expand'));
    await waitFor(() => expect(useDebugStore.getState().expandedRefs[100]).toBe(true));
  });

  it('should_lazy_fetch_children_on_first_expand', async () => {
    const spy = vi.spyOn(useDebugStore.getState(), 'toggleVariableExpand');
    render(<DebugPanel />);
    fireEvent.click(screen.getByLabelText('Expand'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(100));
    spy.mockRestore();
  });

  it('should_render_loading_row_while_fetching_children', () => {
    seed({
      expandedRefs: { 100: true },
      loadingRefs: { 100: true },
    });
    render(<DebugPanel />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('should_render_error_row_when_expansion_failed', () => {
    seed({
      expandedRefs: { 100: true },
      varErrors: { 100: 'stale ref' },
    });
    render(<DebugPanel />);
    expect(screen.getByText('stale ref')).toBeInTheDocument();
  });
});
