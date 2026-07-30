import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '@/shared/types';

import { AgentPopover } from '../AgentPopover';

const agents: AgentConfig[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    env: {},
    icon: null,
    enabled: true,
  },
  { id: 'gemini', name: 'Gemini', command: 'gemini', args: [], env: {}, icon: null, enabled: true },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    args: [],
    env: {},
    icon: null,
    enabled: false,
  },
];

function Host({
  installedMap = new Map(),
  selectedAgentId = null,
  onSelect,
}: {
  installedMap?: Map<string, boolean>;
  selectedAgentId?: string | null;
  onSelect?: (agent: AgentConfig) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  const handleSelect = useCallback(
    (a: AgentConfig) => {
      onSelect?.(a);
      setOpen(false);
    },
    [onSelect],
  );
  return (
    <div>
      <button ref={anchorRef} type="button" data-testid="anchor">
        Anchor
      </button>
      <AgentPopover
        open={open}
        anchorRef={anchorRef}
        agents={agents}
        selectedAgentId={selectedAgentId}
        installedMap={installedMap}
        onSelect={handleSelect}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

describe('AgentPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_render_enabled_agents', () => {
    render(<Host />);
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Gemini')).toBeInTheDocument();
  });

  it('should_not_render_disabled_agents', () => {
    render(<Host />);
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();
  });

  it('should_highlight_selected_agent_with_default_badge', () => {
    render(<Host selectedAgentId="claude" />);
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('should_show_not_installed_badge_for_uninstalled_agents', () => {
    const installedMap = new Map([
      ['claude', true],
      ['gemini', false],
    ]);
    render(<Host installedMap={installedMap} />);
    expect(screen.getByText('Not installed')).toBeInTheDocument();
  });

  it('should_disable_not_installed_agents', () => {
    const installedMap = new Map([['gemini', false]]);
    render(<Host installedMap={installedMap} />);
    const geminiItem = screen.getByRole('menuitem', { name: /Gemini/ });
    expect(geminiItem).toBeDisabled();
  });

  it('should_call_onSelect_when_clicking_an_installed_agent', () => {
    const onSelect = vi.fn();
    render(<Host onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Claude Code'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'claude', name: 'Claude Code' }),
    );
  });

  it('should_close_when_clicking_outside', async () => {
    render(<Host />);
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
    });
  });

  it('should_close_on_escape', async () => {
    render(<Host />);
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
    });
  });

  it('should_sort_selected_agent_first', () => {
    render(<Host selectedAgentId="gemini" />);
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Gemini');
  });
});
