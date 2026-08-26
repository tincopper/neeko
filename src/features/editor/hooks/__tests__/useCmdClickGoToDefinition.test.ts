import type { EditorView } from '@codemirror/view';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LspLocation } from '@/features/lsp/types';

import {
  handleCmdClickToDefinition,
  useCmdClickGoToDefinition,
} from '../useCmdClickGoToDefinition';

vi.mock('@/shared/utils/platform', () => ({ IS_MACOS: true }));

const TAB = {
  filePath: '/repo/src/main.rs',
  projectId: 'proj-1',
  order: 0,
  title: 'main.rs',
  data: { kind: 'file' as const, filePath: '/repo/src/main.rs' },
};

const LOCATION: LspLocation = {
  uri: 'file:///repo/src/lib.rs',
  range: { start: { line: 3, character: 1 }, end: { line: 3, character: 5 } },
};

function makeView(overrides: Record<string, unknown> = {}) {
  return {
    dispatch: vi.fn(),
    posAtCoords: vi.fn(() => 5),
    state: { doc: { lineAt: vi.fn(() => ({ number: 2, from: 3 })) } },
    ...overrides,
  } as unknown as EditorView;
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    metaKey: true,
    ctrlKey: false,
    button: 0,
    preventDefault: vi.fn(),
    clientX: 10,
    clientY: 20,
    ...overrides,
  } as unknown as MouseEvent;
}

describe('handleCmdClickToDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_jump_to_symbol_under_mouse_on_cmd_click', async () => {
    const view = makeView();
    const event = makeEvent();
    const goToDefinition = vi.fn().mockResolvedValue({ location: LOCATION, fileContent: 'src' });
    const navigateToLocation = vi.fn().mockResolvedValue(undefined);

    handleCmdClickToDefinition({
      event,
      view,
      projectPath: '/repo',
      tabKey: 'k1',
      tab: TAB as never,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      navigateToLocation,
    });

    // offset 5 on line 2 (from=3) → LSP line 1, character 2; uri from tab path.
    expect(goToDefinition).toHaveBeenCalledWith('rust', 'file:///repo/src/main.rs', 1, 2);
    await vi.waitFor(() => {
      expect(navigateToLocation).toHaveBeenCalledWith(
        LOCATION,
        '/repo',
        'k1',
        'proj-1',
        '/repo/src/main.rs',
        'src',
      );
    });
  });

  it('should_ignore_non_modifier_click', () => {
    const goToDefinition = vi.fn();
    handleCmdClickToDefinition({
      event: makeEvent({ metaKey: false, ctrlKey: false }),
      view: makeView(),
      projectPath: '/repo',
      tabKey: 'k1',
      tab: TAB as never,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      navigateToLocation: vi.fn(),
    });
    expect(goToDefinition).not.toHaveBeenCalled();
  });

  it('should_ignore_click_when_no_language_id', () => {
    const goToDefinition = vi.fn();
    handleCmdClickToDefinition({
      event: makeEvent(),
      view: makeView(),
      projectPath: '/repo',
      tabKey: 'k1',
      tab: TAB as never,
      lspLanguageIdRef: { current: null },
      goToDefinition,
      navigateToLocation: vi.fn(),
    });
    expect(goToDefinition).not.toHaveBeenCalled();
  });

  it('should_ignore_click_outside_editor', () => {
    const goToDefinition = vi.fn();
    handleCmdClickToDefinition({
      event: makeEvent(),
      view: makeView({ posAtCoords: vi.fn(() => null) }),
      projectPath: '/repo',
      tabKey: 'k1',
      tab: TAB as never,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      navigateToLocation: vi.fn(),
    });
    expect(goToDefinition).not.toHaveBeenCalled();
  });

  it('should_ignore_click_when_position_resolution_fails', () => {
    const goToDefinition = vi.fn();
    handleCmdClickToDefinition({
      event: makeEvent(),
      view: makeView({
        state: {
          doc: {
            lineAt: vi.fn(() => {
              throw new Error('bad line');
            }),
          },
        },
      }),
      projectPath: '/repo',
      tabKey: 'k1',
      tab: TAB as never,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      navigateToLocation: vi.fn(),
    });
    expect(goToDefinition).not.toHaveBeenCalled();
  });
});

describe('useCmdClickGoToDefinition', () => {
  it('should_return_empty_extension_without_project_path', () => {
    const { result } = renderHook(() =>
      useCmdClickGoToDefinition({
        projectPath: null,
        tabKey: 'k1',
        tab: TAB as never,
        lspLanguageIdRef: { current: 'rust' },
        goToDefinition: vi.fn(),
        navigateToLocation: vi.fn(),
      }),
    );
    expect(result.current).toEqual([]);
  });

  it('should_return_dom_event_handler_extension_with_project_path', () => {
    const { result } = renderHook(() =>
      useCmdClickGoToDefinition({
        projectPath: '/repo',
        tabKey: 'k1',
        tab: TAB as never,
        lspLanguageIdRef: { current: 'rust' },
        goToDefinition: vi.fn(),
        navigateToLocation: vi.fn(),
      }),
    );
    // Non-empty extension proves a view-lifetime `domEventHandlers` binding is
    // produced, unlike the previous effect-race ref binding that could no-op.
    expect(result.current).not.toEqual([]);
  });
});
