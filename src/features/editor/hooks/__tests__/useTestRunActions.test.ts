import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockStart = vi.hoisted(() => vi.fn());
const mockStartWithConfig = vi.hoisted(() => vi.fn());
const mockActiveWorktreePath = vi.hoisted(() => ({ value: null as string | null }));
const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
vi.mock('@/features/task/taskRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/task/taskRunner')>();
  return {
    ...actual,
    startTaskProcess: (...args: unknown[]) => mockStart(...args),
    stopTaskProcess: vi.fn(),
  };
});

vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      activeProject: { id: 'proj-1', path: '/tmp/proj', name: 'proj' },
      projects: [{ id: 'proj-1', path: '/tmp/proj', name: 'proj' }],
      activeProjectId: 'proj-1',
    }),
  },
}));

vi.mock('@/shared/store/worktreeStore', () => ({
  useWorktreeStore: {
    getState: () => ({ activeWorktreePath: mockActiveWorktreePath.value }),
  },
}));

vi.mock('@/features/debug/store/debugStore', () => ({
  useDebugStore: {
    getState: () => ({ startWithConfig: mockStartWithConfig }),
  },
}));

vi.mock('@/shared/utils/bottomPanelExclusive', () => ({
  exclusiveOpenTaskConsole: vi.fn(),
  registerTaskConsoleCloser: vi.fn(),
}));

import { useOverlayStore } from '@/shared/store/overlayStore';
import { useTaskStore } from '@/shared/store/taskStore';

import { statusForCase, useTestResultsStore } from '../../store/testResults';
import { clearCargoManifestCache } from '../../utils/cargoManifest';
import { useTestRunActions } from '../useTestRunActions';

describe('useTestRunActions', () => {
  beforeEach(() => {
    mockStart.mockReset();
    mockStartWithConfig.mockReset();
    clearCargoManifestCache();
    mockStartWithConfig.mockResolvedValue({
      sessionId: 'dap-1',
      projectId: 'proj-1',
      projectPath: '/tmp/proj',
      configName: 'test',
      status: 'starting',
    });
    mockStart.mockResolvedValue({ processId: 'pty-1', dispose: vi.fn() });
    mockInvoke.mockResolvedValue(false); // 默认根清单布局（探测全部不存在）
    mockActiveWorktreePath.value = null;
    useTaskStore.setState({
      configs: [],
      discovered: [],
      selectedConfigId: null,
      consolePanelOpen: false,
      consoleSessions: [],
      activeConsoleId: null,
    });
  });

  describe('run (TS/JS + Rust → Task Console)', () => {
    it('should_launch_vitest_command_via_task_console', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/a.test.ts',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleRunTest({ name: 'adds', line: 2, lang: 'ts' }));

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      const opts = mockStart.mock.calls[0][0];
      expect(opts.command).toBe(
        "pnpm vitest run 'src/a.test.ts' -t 'adds'" +
          " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
      );
      expect(opts.cwd).toBe('/tmp/proj');
      // Console session visible + focused
      const state = useTaskStore.getState();
      expect(state.consolePanelOpen).toBe(true);
      expect(state.consoleSessions).toHaveLength(1);
      expect(state.consoleSessions[0].status).toBe('running');
    });

    it('should_prefer_worktree_root_as_cwd_when_active', async () => {
      mockActiveWorktreePath.value = '/tmp/proj/.worktrees/fix-1';
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleRunTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(mockStart.mock.calls[0][0].command).toBe(
        "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
      );
      expect(mockStart.mock.calls[0][0].cwd).toBe('/tmp/proj/.worktrees/fix-1');
    });
  });
  describe('run result stream (libtest JSON / vitest report → testResults store)', () => {
    beforeEach(() => {
      useTestResultsStore.setState({ files: {}, versions: {} });
    });

    it('should_begin_run_before_spawn_and_land_libtest_result_on_exit', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleRunTest({ name: 'parse_simple', line: 1, lang: 'rust' }));
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      // spawn 前 beginRun：running 占位（gutter 半透明图标）
      expect(statusForCase('proj-1', 'src/lib.rs', 'parse_simple')).toEqual({ status: 'running' });

      const opts = mockStart.mock.calls[0][0];
      opts.onOutput(
        '   Compiling neeko v0.1.0 (/tmp/proj)\n' +
          JSON.stringify({ type: 'test', event: 'started', name: 'tests::parse_simple' }) +
          '\n' +
          JSON.stringify({
            type: 'test',
            event: 'ok',
            name: 'tests::parse_simple',
            exec_time: 0.002,
          }) +
          '\n',
      );
      opts.onExit(0);

      await waitFor(() =>
        expect(statusForCase('proj-1', 'src/lib.rs', 'parse_simple')).toEqual({
          status: 'passed',
          duration: 2,
        }),
      );
    });

    it('should_land_failed_status_with_stdout_summary_and_drop_non_matching_events', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );
      act(() => result.current.handleRunTest({ name: 'parse_simple', line: 1, lang: 'rust' }));
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

      const opts = mockStart.mock.calls[0][0];
      opts.onOutput(
        // 子串过滤误跑的同前缀用例：无 :: 边界，不得对齐
        JSON.stringify({ type: 'test', event: 'failed', name: 'my_parse_simple', stdout: 'x' }) +
          '\n' +
          JSON.stringify({
            type: 'test',
            event: 'failed',
            name: 'tests::parse_simple',
            stdout: 'assertion `left == right` failed',
          }) +
          '\n',
      );
      opts.onExit(101);

      await waitFor(() =>
        expect(statusForCase('proj-1', 'src/lib.rs', 'parse_simple')).toEqual({
          status: 'failed',
          message: 'assertion `left == right` failed',
        }),
      );
    });

    it('should_clear_running_state_when_output_has_no_libtest_events', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );
      act(() => result.current.handleRunTest({ name: 'parse_simple', line: 1, lang: 'rust' }));
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

      const opts = mockStart.mock.calls[0][0];
      opts.onOutput('error[E0432]: unresolved import\n');
      opts.onExit(101);

      await waitFor(() => expect(statusForCase('proj-1', 'src/lib.rs', 'parse_simple')).toBeNull());
    });

    it('should_read_vitest_report_after_exit_and_align_describe_prefixed_name', async () => {
      const report = {
        testResults: [
          {
            assertionResults: [
              {
                ancestorTitles: ['math'],
                fullName: 'math adds',
                title: 'adds',
                status: 'failed',
                duration: 3,
                failureMessages: ['expected 2 to be 3'],
              },
              {
                ancestorTitles: ['math'],
                fullName: 'math other',
                title: 'other',
                status: 'passed',
                duration: 1,
                failureMessages: [],
              },
            ],
          },
        ],
      };
      mockInvoke.mockImplementation((cmd: string, args: { filePath?: string }) =>
        cmd === 'read_file_content' && args.filePath === 'node_modules/.neeko/vitest-report.json'
          ? Promise.resolve({
              path: 'x',
              content: JSON.stringify(report),
              size: 1,
              is_binary: false,
            })
          : Promise.resolve(false),
      );
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/a.test.ts',
          projectPath: '/tmp/proj',
        }),
      );
      act(() => result.current.handleRunTest({ name: 'adds', line: 2, lang: 'ts' }));
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

      const opts = mockStart.mock.calls[0][0];
      opts.onExit(1); // 失败用例 → vitest 退出码非 0，报告仍写

      await waitFor(() =>
        expect(statusForCase('proj-1', 'src/a.test.ts', 'adds')).toEqual({
          status: 'failed',
          duration: 3,
          message: 'expected 2 to be 3',
        }),
      );
      // 报告经 run 根相对路径读取（rootPath = run cwd）
      expect(mockInvoke).toHaveBeenCalledWith('read_file_content', {
        projectId: 'proj-1',
        filePath: 'node_modules/.neeko/vitest-report.json',
        rootPath: '/tmp/proj',
      });
      // 未命中的用例不落状态
      expect(statusForCase('proj-1', 'src/a.test.ts', 'other')).toBeNull();
    });

    it('should_clear_running_state_when_report_read_fails', async () => {
      mockInvoke.mockImplementation((cmd: string) =>
        cmd === 'read_file_content' ? Promise.reject(new Error('missing')) : Promise.resolve(false),
      );
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/a.test.ts',
          projectPath: '/tmp/proj',
        }),
      );
      act(() => result.current.handleRunTest({ name: 'adds', line: 2, lang: 'ts' }));
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      mockStart.mock.calls[0][0].onExit(1);

      await waitFor(() => expect(statusForCase('proj-1', 'src/a.test.ts', 'adds')).toBeNull());
    });

    it('should_invalidate_running_marker_when_task_fails_to_start', async () => {
      mockStart.mockRejectedValue(new Error('spawn failed'));
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleRunTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      await waitFor(() => expect(statusForCase('proj-1', 'src/lib.rs', 'parse_simple')).toBeNull());
    });
  });

  describe('debug (Rust → --no-run → parse binary → lldb session)', () => {
    it('should_build_binary_then_start_debug_session_with_parsed_program', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      // Build runs in Task Console
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      const buildOpts = mockStart.mock.calls[0][0];
      expect(buildOpts.command).toBe("cargo test 'parse_simple' --no-run");

      buildOpts.onOutput(
        '   Compiling neeko v0.1.0 (/tmp/proj)\n' +
          '    Finished test [unoptimized + debuginfo] target(s) in 2.11s\n' +
          '     Running unittests src/lib.rs (target/debug/deps/neeko-abc123)\n',
      );
      buildOpts.onExit(0);

      await waitFor(() => expect(mockStartWithConfig).toHaveBeenCalledTimes(1));
      expect(mockStartWithConfig).toHaveBeenCalledWith('proj-1', {
        name: 'Debug test: parse_simple',
        type: 'lldb',
        request: 'launch',
        program: '/tmp/proj/target/debug/deps/neeko-abc123',
        cwd: '/tmp/proj',
        args: ['parse_simple'],
        stopOnEntry: false,
      });
    });

    it('should_append_manifest_path_for_tauri_layout_projects', async () => {
      mockInvoke.mockImplementation((cmd: string, args: { path: string }) =>
        Promise.resolve(cmd === 'file_exists' && args.path === '/tmp/proj/src-tauri/Cargo.toml'),
      );
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src-tauri/tests/unit/acp_test.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(mockStart.mock.calls[0][0].command).toBe(
        "cargo test 'parse_simple' --no-run --manifest-path 'src-tauri/Cargo.toml'",
      );
    });

    it('should_not_start_session_when_build_fails', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      mockStart.mock.calls[0][0].onOutput('error[E0432]: unresolved import\n');
      mockStart.mock.calls[0][0].onExit(101);

      await waitFor(() => expect(useTaskStore.getState().consoleSessions[0].status).toBe('failed'));
      expect(mockStartWithConfig).not.toHaveBeenCalled();
    });

    it('should_not_start_session_when_output_has_no_test_binary', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      mockStart.mock.calls[0][0].onOutput('Finished in 1s\n');
      mockStart.mock.calls[0][0].onExit(0);

      await waitFor(() => expect(useTaskStore.getState().consoleSessions[0].status).toBe('idle'));
      expect(mockStartWithConfig).not.toHaveBeenCalled();
    });

    it('should_ignore_debug_for_ts_cases', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/a.test.ts',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebugTest({ name: 'adds', line: 2, lang: 'ts' }));
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockStartWithConfig).not.toHaveBeenCalled();
    });
  });

  describe('menu (rust gutter click → Run/Debug dropdown)', () => {
    beforeEach(() => {
      useOverlayStore.getState().reset();
    });

    it('openMenu_stores_case_with_click_position_and_reports_overlay_open', () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );
      const testCase = { name: 'parse_simple', line: 1, lang: 'rust' as const };

      act(() => result.current.openMenu(testCase, 120, 88));

      expect(result.current.menu).toEqual({ testCase, x: 120, y: 88 });
      // z-order 惯例：菜单打开期间占用 overlay 计数
      expect(useOverlayStore.getState().open['editor-test-run-menu']).toBe(true);
    });

    it('menu_shows_run_and_debug_labeled_with_test_name_for_rust_cases', () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.openMenu({ name: 'parse_simple', line: 1, lang: 'rust' }, 10, 20));

      const items = result.current.menuItems;
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ label: "Test 'parse_simple'" });
      expect(items[1]).toMatchObject({ label: "Debug 'Test parse_simple'" });
    });

    it('menu_labels_follow_the_opened_case_name', () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.openMenu({ name: 'other_case', line: 3, lang: 'rust' }, 10, 20));

      const items = result.current.menuItems;
      expect(items[0]).toMatchObject({ label: "Test 'other_case'" });
      expect(items[1]).toMatchObject({ label: "Debug 'Test other_case'" });
    });

    it('run_item_launches_run_command_and_debug_item_starts_no_run_build', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );
      act(() => result.current.openMenu({ name: 'parse_simple', line: 1, lang: 'rust' }, 10, 20));

      act(() => result.current.menuItems[0].action());
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(mockStart.mock.calls[0][0].command).toBe(
        "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
      );

      act(() => result.current.menuItems[1].action());
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(2));
      expect(mockStart.mock.calls[1][0].command).toBe("cargo test 'parse_simple' --no-run");
    });

    it('closeMenu_clears_state_and_releases_overlay', () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.openMenu({ name: 'parse_simple', line: 1, lang: 'rust' }, 10, 20));
      act(() => result.current.closeMenu());

      expect(result.current.menu).toBeNull();
      expect(result.current.menuItems).toEqual([]);
      expect(useOverlayStore.getState().open['editor-test-run-menu']).toBe(false);
    });

    it('releases_overlay_on_unmount_while_menu_open', () => {
      const { result, unmount } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.openMenu({ name: 'parse_simple', line: 1, lang: 'rust' }, 10, 20));
      unmount();

      expect(useOverlayStore.getState().open['editor-test-run-menu']).toBe(false);
    });
  });
});
