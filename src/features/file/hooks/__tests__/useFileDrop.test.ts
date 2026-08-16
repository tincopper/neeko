import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sendToTerminal } from '@/features/terminal';
import { INSERT_TO_AGENT_INPUT_EVENT } from '@/shared/events';
import { useEditorStore } from '@/shared/store/editorStore';

import { setDragFile, useFileDrop } from '../useFileDrop';

// Mock the terminal module
vi.mock('@/features/terminal', () => ({
  sendToTerminal: vi.fn(),
}));

// Mock editor store
vi.mock('@/shared/store/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
  },
}));

describe('useFileDrop', () => {
  let dispatchedEvents: CustomEvent[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    dispatchedEvents = [];

    // Capture dispatched CustomEvents
    const originalDispatch = window.dispatchEvent;
    vi.spyOn(window, 'dispatchEvent').mockImplementation((event: Event) => {
      if (event instanceof CustomEvent) {
        dispatchedEvents.push(event);
      }
      return originalDispatch.call(window, event);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mountHook() {
    return renderHook(() => useFileDrop());
  }

  it('should dispatch INSERT_TO_AGENT_INPUT_EVENT when focus is in a textarea', () => {
    mountHook();

    // Setup: textarea is focused
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    // Set a pending drag (simulating dragStart on a directory node)
    act(() => {
      setDragFile('/some/directory', 'proj-1');
    });

    // Simulate dragend
    act(() => {
      document.dispatchEvent(new Event('dragend'));
    });

    // Verify: INSERT_TO_AGENT_INPUT_EVENT was dispatched
    expect(dispatchedEvents).toHaveLength(1);
    expect(dispatchedEvents[0].type).toBe(INSERT_TO_AGENT_INPUT_EVENT);
    expect(dispatchedEvents[0].detail).toEqual({ text: '/some/directory ' });

    // Verify: sendToTerminal was NOT called
    expect(sendToTerminal).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('should dispatch INSERT_TO_AGENT_INPUT_EVENT when focus is in a contenteditable', () => {
    mountHook();

    // Setup: contenteditable is focused
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    editable.focus();

    // Set a pending drag
    act(() => {
      setDragFile('/another/dir', 'proj-2');
    });

    // Simulate dragend
    act(() => {
      document.dispatchEvent(new Event('dragend'));
    });

    // Verify: event dispatched
    expect(dispatchedEvents).toHaveLength(1);
    expect(dispatchedEvents[0].type).toBe(INSERT_TO_AGENT_INPUT_EVENT);
    expect(dispatchedEvents[0].detail).toEqual({ text: '/another/dir ' });

    expect(sendToTerminal).not.toHaveBeenCalled();

    document.body.removeChild(editable);
  });

  it('should sendToTerminal when active tab is a terminal and no text input is focused', () => {
    mountHook();

    // Setup: store returns a terminal tab
    vi.mocked(useEditorStore.getState).mockReturnValue({
      tabs: {
        'proj-1': {
          tabs: [{ id: 'tab-1', data: { kind: 'terminal' } }],
          activeTabId: 'tab-1',
        },
      },
      activeTabId: 'tab-1',
    } as any);

    // No text input focused
    act(() => {
      setDragFile('/some/file.txt', 'proj-1');
    });

    // Simulate dragend
    act(() => {
      document.dispatchEvent(new Event('dragend'));
    });

    // Verify: sendToTerminal was called
    expect(sendToTerminal).toHaveBeenCalledWith('proj-1', '/some/file.txt ', 'tab-1');

    // Verify: no CustomEvent dispatched
    expect(dispatchedEvents).toHaveLength(0);
  });

  it('should NOT send to agent input when focus is in a non-text INPUT (e.g. checkbox)', () => {
    mountHook();

    // Setup: checkbox is focused (not a text input)
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.appendChild(checkbox);
    checkbox.focus();

    // Setup: store returns a terminal tab
    vi.mocked(useEditorStore.getState).mockReturnValue({
      tabs: {
        'proj-1': {
          tabs: [{ id: 'tab-1', data: { kind: 'terminal' } }],
          activeTabId: 'tab-1',
        },
      },
      activeTabId: 'tab-1',
    } as any);

    act(() => {
      setDragFile('/some/path', 'proj-1');
    });

    act(() => {
      document.dispatchEvent(new Event('dragend'));
    });

    // Verify: sendToTerminal was called (not agent input)
    expect(sendToTerminal).toHaveBeenCalledWith('proj-1', '/some/path ', 'tab-1');
    expect(dispatchedEvents).toHaveLength(0);

    document.body.removeChild(checkbox);
  });

  it('should do nothing when no pending drag', () => {
    mountHook();

    // No setDragFile called, just dispatch dragend
    act(() => {
      document.dispatchEvent(new Event('dragend'));
    });

    expect(sendToTerminal).not.toHaveBeenCalled();
    expect(dispatchedEvents).toHaveLength(0);
  });

  it('should clear pendingDrag after handling', () => {
    mountHook();

    // Setup: textarea focused
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    act(() => {
      setDragFile('/dir/path', 'proj-1');
    });

    act(() => {
      document.dispatchEvent(new Event('dragend'));
    });

    // First dragend handled
    expect(dispatchedEvents).toHaveLength(1);

    // Second dragend should do nothing (pendingDrag cleared)
    act(() => {
      document.dispatchEvent(new Event('dragend'));
    });

    expect(dispatchedEvents).toHaveLength(1); // Still 1, no new event

    document.body.removeChild(textarea);
  });
});
