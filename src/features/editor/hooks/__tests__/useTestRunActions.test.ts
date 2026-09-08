import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockStart = vi.hoisted(() => vi.fn());
const mockStartWithConfig = vi.hoisted(() => vi.fn());
const mockOpenDebugPanel = vi.hoisted(() => vi.fn());
const mockPushConsole = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());
const mockActiveWorktreePath = vi.hoisted(() => ({ value: null as string | null }));
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
    getState: () => ({
      startWithConfig: mockStartWithConfig,
      openPanel: mockOpenDebugPanel,
      pushConsole: mockPushConsole,
    }),
  },
}));

vi.mock('@/shared/utils/bottomPanelExclusive', () => ({
  exclusiveOpenTaskConsole: vi.fn(),
  registerTaskConsoleCloser: vi.fn(),
}));

import { useNotificationStore } from '@/shared/store/notificationStore';
import { useOverlayStore } from '@/shared/store/overlayStore';
import { useTaskStore } from '@/shared/store/taskStore';

import { statusForCase, useTestResultsStore } from '../../store/testResults';
import { clearCargoManifestCache } from '../../utils/cargoManifest';
import { useTestRunActions } from '../useTestRunActions';

describe('useTestRunActions', () => {
  beforeEach(() => {
    mockStart.mockReset();
    mockStartWithConfig.mockReset();
    mockOpenDebugPanel.mockReset();
    mockPushConsole.mockReset();
    mockInvoke.mockReset();
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
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

    it('should_launch_go_test_via_task_console_with_anchored_run_and_json', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleRunTest({ name: 'TestAdd', line: 3, lang: 'go' }));

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(mockStart.mock.calls[0][0].command).toBe(
        "go test -run '^TestAdd$' -json './pkg/math'",
      );
      expect(mockStart.mock.calls[0][0].cwd).toBe('/tmp/proj');
      // Console session visible + focused
      const state = useTaskStore.getState();
      expect(state.consolePanelOpen).toBe(true);
      expect(state.consoleSessions).toHaveLength(1);
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

    it('should_land_go_test2json_status_on_exit_for_go_cases', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );
      act(() => result.current.handleRunTest({ name: 'TestAdd', line: 3, lang: 'go' }));
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      // spawn 前 beginRun：running 占位
      expect(statusForCase('proj-1', 'pkg/math/add_test.go', 'TestAdd')).toEqual({
        status: 'running',
      });

      const opts = mockStart.mock.calls[0][0];
      opts.onOutput(
        JSON.stringify({ Action: 'run', Package: 'math', Test: 'TestAdd' }) +
          '\n' +
          JSON.stringify({ Action: 'output', Test: 'TestAdd', Output: '=== RUN   TestAdd\n' }) +
          '\n' +
          JSON.stringify({ Action: 'output', Test: 'TestAdd', Output: 'add_test.go:10: boom\n' }) +
          '\n' +
          JSON.stringify({ Action: 'fail', Test: 'TestAdd', Elapsed: 0.002 }) +
          '\n',
      );
      opts.onExit(1);

      await waitFor(() =>
        expect(statusForCase('proj-1', 'pkg/math/add_test.go', 'TestAdd')).toEqual({
          status: 'failed',
          duration: 2,
          message: 'add_test.go:10: boom\n',
        }),
      );
    });

    it('should_clear_go_running_state_when_output_has_no_test2json_events', async () => {
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );
      act(() => result.current.handleRunTest({ name: 'TestAdd', line: 3, lang: 'go' }));
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

      const opts = mockStart.mock.calls[0][0];
      opts.onOutput('go: cannot find main module\n');
      opts.onExit(1);

      await waitFor(() =>
        expect(statusForCase('proj-1', 'pkg/math/add_test.go', 'TestAdd')).toBeNull(),
      );
    });
  });
  describe('debug (Rust → headless build → parse binary → lldb session)', () => {
    const artifactOutput = (srcPath: string, binary: string) =>
      '   Compiling neeko v0.1.0 (/tmp/proj)\n' +
      `${JSON.stringify({
        reason: 'compiler-artifact',
        target: { kind: ['lib'], name: 'neeko', src_path: srcPath },
        profile: { test: true },
        executable: binary,
      })}\n`;

    const mockHeadlessBuild = (stdout: string, exitCode = 0) => {
      mockInvoke.mockImplementation((cmd: string, args: { path?: string }) => {
        if (cmd === 'debug_build_test_binary') {
          return Promise.resolve({ exit_code: exitCode, stdout });
        }
        // 根布局项目：`src/lib.rs` 存在（lib target 探测）→ targetFlag 锁定 `--lib`
        return Promise.resolve(cmd === 'file_exists' && args.path?.endsWith('/src/lib.rs'));
      });
    };

    const renderDebugHook = (filePath = 'src/lib.rs') =>
      renderHook(() =>
        useTestRunActions({ projectId: 'proj-1', filePath, projectPath: '/tmp/proj' }),
      );

    const notifiedWith = (part: string) =>
      useNotificationStore.getState().notifications.some((n) => n.message.includes(part));

    it('should_open_debug_panel_pending_and_build_headless_without_task_session', async () => {
      mockHeadlessBuild(
        artifactOutput('/tmp/proj/src/lib.rs', '/tmp/proj/target/debug/deps/neeko-abc123'),
      );
      const { result } = renderDebugHook();

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      // pending：点击瞬间 DebugPanel 打开（console tab + 构建中提示），Task Console 永不参与
      await waitFor(() => expect(mockOpenDebugPanel).toHaveBeenCalledWith('console'));
      expect(mockPushConsole).toHaveBeenCalledWith('sys', expect.stringContaining('构建'));
      // 无头构建：一次独立 invoke，无任务会话、无 observer
      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('debug_build_test_binary', {
          projectId: 'proj-1',
          command: "cargo test 'parse_simple' --no-run --lib --message-format=json",
          cwd: '/tmp/proj',
        }),
      );
      expect(mockStart).not.toHaveBeenCalled();
      expect(useTaskStore.getState().consoleSessions).toHaveLength(0);
      expect(useTaskStore.getState().consolePanelOpen).toBe(false);

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
      mockInvoke.mockImplementation((cmd: string, args: { path: string }) => {
        if (cmd === 'debug_build_test_binary') {
          return Promise.resolve({
            exit_code: 0,
            stdout: artifactOutput(
              '/tmp/proj/src-tauri/src/agent/chat/adapter/serve.rs',
              '/tmp/proj/src-tauri/target/debug/deps/neeko_lib-abc123',
            ),
          });
        }
        return Promise.resolve(
          cmd === 'file_exists' &&
            (args.path === '/tmp/proj/src-tauri/Cargo.toml' ||
              args.path === '/tmp/proj/src-tauri/src/lib.rs'),
        );
      });
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src-tauri/src/agent/chat/adapter/serve.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith(
          'debug_build_test_binary',
          expect.objectContaining({
            command:
              "cargo test 'parse_simple' --no-run --lib --manifest-path 'src-tauri/Cargo.toml' --message-format=json",
          }),
        ),
      );
    });

    it('should_probe_manifest_and_lib_under_active_worktree_not_project_root', async () => {
      mockActiveWorktreePath.value = '/tmp/proj/.worktrees/fix-1';
      const probed: string[] = [];
      mockInvoke.mockImplementation((cmd: string, args: { path?: string }) => {
        if (cmd === 'debug_build_test_binary') {
          return Promise.resolve({
            exit_code: 0,
            stdout: artifactOutput(
              '/tmp/proj/.worktrees/fix-1/src-tauri/src/lib.rs',
              '/tmp/proj/.worktrees/fix-1/src-tauri/target/debug/deps/neeko_lib-abc123',
            ),
          });
        }
        if (cmd === 'file_exists') {
          probed.push(args.path ?? '');
          // 仅 worktree 下有 Tauri 布局清单 + lib target；主工作树探测全 false
          return Promise.resolve(
            args.path === '/tmp/proj/.worktrees/fix-1/src-tauri/Cargo.toml' ||
              args.path === '/tmp/proj/.worktrees/fix-1/src-tauri/src/lib.rs',
          );
        }
        return Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'src-tauri/src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      // member 定位与 lib 探测基准 = 实际执行目录（worktree），构建命令带
      // `--manifest-path`（探测命中 worktree 清单）；cwd 也是 worktree。
      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith(
          'debug_build_test_binary',
          expect.objectContaining({
            command:
              "cargo test 'parse_simple' --no-run --lib --manifest-path 'src-tauri/Cargo.toml' --message-format=json",
            cwd: '/tmp/proj/.worktrees/fix-1',
          }),
        ),
      );
      expect(probed).toContain('/tmp/proj/.worktrees/fix-1/src-tauri/Cargo.toml');
      expect(probed).toContain('/tmp/proj/.worktrees/fix-1/src-tauri/src/lib.rs');
      expect(probed).not.toContain('/tmp/proj/src-tauri/Cargo.toml');
      expect(probed).not.toContain('/tmp/proj/src-tauri/src/lib.rs');
    });

    it('should_build_independently_on_repeated_clicks_without_reuse', async () => {
      mockHeadlessBuild(
        artifactOutput('/tmp/proj/src/lib.rs', '/tmp/proj/target/debug/deps/neeko-abc123'),
      );
      const { result } = renderDebugHook();

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));
      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      // 二次点击 = 第二次独立构建，无复用、无挂起
      await waitFor(() =>
        expect(
          mockInvoke.mock.calls.filter((c) => c[0] === 'debug_build_test_binary'),
        ).toHaveLength(2),
      );
      await waitFor(() => expect(mockStartWithConfig).toHaveBeenCalledTimes(2));
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('should_not_start_session_when_build_fails', async () => {
      mockHeadlessBuild('error[E0432]: unresolved import\n', 101);
      const { result } = renderDebugHook();

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      await waitFor(() => expect(notifiedWith('构建失败')).toBe(true));
      expect(mockStartWithConfig).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      // 失败落 DebugPanel console（附构建日志尾部），Task Console 无会话
      expect(mockOpenDebugPanel).toHaveBeenCalledWith('console');
      expect(mockPushConsole).toHaveBeenCalledWith(
        'err',
        expect.stringContaining('unresolved import'),
      );
      expect(useTaskStore.getState().consoleSessions).toHaveLength(0);
    });

    it('should_not_start_session_when_output_has_no_test_binary', async () => {
      mockHeadlessBuild('Finished in 1s\n');
      const { result } = renderDebugHook();

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      await waitFor(() => expect(notifiedWith('测试二进制')).toBe(true));
      expect(mockStartWithConfig).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockOpenDebugPanel).toHaveBeenCalledWith('console');
      expect(useTaskStore.getState().consoleSessions).toHaveLength(0);
    });

    it('should_notify_when_multiple_binaries_cannot_be_disambiguated', async () => {
      mockHeadlessBuild(
        artifactOutput('/tmp/proj/src/lib.rs', '/tmp/proj/target/debug/deps/neeko-abc123') +
          artifactOutput('/tmp/proj/src/main.rs', '/tmp/proj/target/debug/deps/neeko-bin-def456'),
      );
      const { result } = renderDebugHook('src/other.rs');

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      await waitFor(() => expect(notifiedWith('多个测试二进制')).toBe(true));
      expect(mockStartWithConfig).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockOpenDebugPanel).toHaveBeenCalledWith('console');
    });

    it('should_notify_with_command_and_cwd_when_headless_spawn_fails', async () => {
      mockInvoke.mockImplementation((cmd: string) =>
        cmd === 'debug_build_test_binary'
          ? Promise.reject(new Error('spawn failed'))
          : Promise.resolve(false),
      );
      const { result } = renderDebugHook();

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      await waitFor(() =>
        expect(
          useNotificationStore
            .getState()
            .notifications.some(
              (n) => n.message.includes('cargo test') && n.message.includes('/tmp/proj'),
            ),
        ).toBe(true),
      );
      expect(mockStartWithConfig).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('should_not_duplicate_notification_when_dap_start_fails', async () => {
      mockStartWithConfig.mockRejectedValue(new Error('lldb missing'));
      mockHeadlessBuild(
        artifactOutput('/tmp/proj/src/lib.rs', '/tmp/proj/target/debug/deps/neeko-abc123'),
      );
      const { result } = renderDebugHook();

      act(() => result.current.handleDebugTest({ name: 'parse_simple', line: 1, lang: 'rust' }));

      await waitFor(() => expect(mockStartWithConfig).toHaveBeenCalledTimes(1));
      // launchSession 错误路径已通知，此处不重复
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
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
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should_build_go_test_binary_headless_and_launch_dlv_exec', async () => {
      mockInvoke.mockImplementation((cmd: string) =>
        cmd === 'debug_build_test_binary'
          ? // go test -c 成功时无 stdout（产物落 `-o` 显式路径）
            Promise.resolve({ exit_code: 0, stdout: '' })
          : Promise.resolve(false),
      );
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebugTest({ name: 'TestAdd', line: 3, lang: 'go' }));

      // pending：DebugPanel 打开，Task Console 永不参与
      await waitFor(() => expect(mockOpenDebugPanel).toHaveBeenCalledWith('console'));
      expect(mockPushConsole).toHaveBeenCalledWith('sys', expect.stringContaining('构建'));
      // 无头构建：go test -c + 显式 `-o`（gitignored .neeko/）+ 无优化 -gcflags
      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('debug_build_test_binary', {
          projectId: 'proj-1',
          command: "go test -c -o '.neeko/test-bin/TestAdd' -gcflags 'all=-N -l' './pkg/math'",
          cwd: '/tmp/proj',
        }),
      );
      expect(mockStart).not.toHaveBeenCalled();
      expect(useTaskStore.getState().consoleSessions).toHaveLength(0);

      // dlv exec launch：program = `-o` 显式产物绝对路径；type go + mode exec
      await waitFor(() => expect(mockStartWithConfig).toHaveBeenCalledTimes(1));
      expect(mockStartWithConfig).toHaveBeenCalledWith('proj-1', {
        name: 'Debug test: TestAdd',
        type: 'go',
        request: 'launch',
        program: '/tmp/proj/.neeko/test-bin/TestAdd',
        cwd: '/tmp/proj',
        mode: 'exec',
        args: ['^TestAdd$'],
        stopOnEntry: false,
      });
    });

    it('should_not_start_go_session_when_go_build_fails', async () => {
      mockInvoke.mockImplementation((cmd: string) =>
        cmd === 'debug_build_test_binary'
          ? Promise.resolve({ exit_code: 1, stdout: 'add_test.go:1: undefined: add\n' })
          : Promise.resolve(false),
      );
      const { result } = renderHook(() =>
        useTestRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebugTest({ name: 'TestAdd', line: 3, lang: 'go' }));

      await waitFor(() => expect(notifiedWith('构建失败')).toBe(true));
      expect(mockStartWithConfig).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockPushConsole).toHaveBeenCalledWith('err', expect.stringContaining('undefined'));
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

    it('run_item_launches_run_command_and_debug_item_builds_headless', async () => {
      mockInvoke.mockImplementation((cmd: string, args: { path?: string }) =>
        cmd === 'debug_build_test_binary'
          ? Promise.resolve({ exit_code: 0, stdout: '' })
          : Promise.resolve(cmd === 'file_exists' && args.path?.endsWith('/src/lib.rs')),
      );
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
      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith(
          'debug_build_test_binary',
          expect.objectContaining({
            command: "cargo test 'parse_simple' --no-run --lib --message-format=json",
          }),
        ),
      );
      // Debug 不再经任务会话：run 的一次 mockStart 之外无新增
      expect(mockStart).toHaveBeenCalledTimes(1);
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
