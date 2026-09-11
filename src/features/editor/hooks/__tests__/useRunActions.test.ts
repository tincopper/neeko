import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockStart = vi.hoisted(() => vi.fn());
const mockStartWithConfig = vi.hoisted(() => vi.fn());
const mockStartJavaAttach = vi.hoisted(() => vi.fn());
const mockOpenDebugPanel = vi.hoisted(() => vi.fn());
const mockPushConsole = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());
const mockActiveWorktreePath = vi.hoisted(() => ({ value: null as string | null }));
const mockHomeDir = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
vi.mock('@tauri-apps/api/path', () => ({ homeDir: mockHomeDir }));
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
      startJavaAttach: mockStartJavaAttach,
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

import { statusForCase, subtestsForCase, useTestResultsStore } from '../../store/testResults';
import { clearCargoManifestCache } from '../../utils/cargoManifest';
import {
  benchmarkDebugLabel,
  benchmarkRunLabel,
  mainDebugLabel,
  mainRunLabel,
  useRunActions,
} from '../useRunActions';

describe('useRunActions', () => {
  beforeEach(() => {
    mockStart.mockReset();
    mockStartWithConfig.mockReset();
    mockStartJavaAttach.mockReset();
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
    mockStartJavaAttach.mockResolvedValue({
      sessionId: 'dap-9',
      projectId: 'proj-1',
      projectPath: '/tmp/proj',
      configName: 'Debug test: testAdd',
      status: 'starting',
    });
    mockStart.mockResolvedValue({ processId: 'pty-1', dispose: vi.fn() });
    // 默认：文件全部不存在（根清单布局探测），但 ~/.neeko/ 的 JUnit Console Launcher
    // jar 视为已就绪（Java 用例走真实命令构造路径）。
    mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
      if (
        cmd === 'file_exists' &&
        String(args?.path ?? '').includes('.neeko/junit-platform-console-standalone')
      ) {
        return Promise.resolve(true);
      }
      // Java 编译产物预检：单模块用例类视为已编译（多模块/缺失场景各用例自行覆盖 mock）
      if (
        cmd === 'file_exists' &&
        /\/target\/(test-)?classes\/.+\.class$/.test(String(args?.path ?? ''))
      ) {
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    });
    mockHomeDir.mockResolvedValue('/Users/tester');
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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/a.test.ts',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleRun({ kind: 'test', testCase: { name: 'adds', line: 2, lang: 'ts' } }),
      );

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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(mockStart.mock.calls[0][0].command).toBe(
        "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
      );
      expect(mockStart.mock.calls[0][0].cwd).toBe('/tmp/proj/.worktrees/fix-1');
    });

    it('should_launch_go_test_via_task_console_with_anchored_run_and_json', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'TestAdd', line: 3, lang: 'go' },
        }),
      );

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

    it('should_launch_junit_launcher_via_task_console_for_java_cases', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/test/java/com/example/CalculatorTest.java',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'testAdd', line: 4, lang: 'java' },
        }),
      );

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      // launcher（~/.neeko/ 缓存）+ --class-path（target/ 输出；无 Maven 产物时
      // 退化为仅 target/）+ 类/方法选择器 + reports-dir。
      expect(mockStart.mock.calls[0][0].command).toBe(
        "java -jar '/Users/tester/.neeko/junit-platform-console-standalone-1.14.4.jar'" +
          " --class-path='/tmp/proj/target/classes:/tmp/proj/target/test-classes'" +
          " -m 'com.example.CalculatorTest#testAdd' --reports-dir='/tmp/proj/.neeko/junit-reports'",
      );
      expect(mockStart.mock.calls[0][0].cwd).toBe('/tmp/proj');
      // Console session visible + focused（JUnit 控制台文本进 Task Console）
      const state = useTaskStore.getState();
      expect(state.consolePanelOpen).toBe(true);
      expect(state.consoleSessions).toHaveLength(1);
      expect(state.consoleSessions[0].status).toBe('running');
    });

    it('should_notify_download_and_skip_run_when_java_launcher_jar_missing', async () => {
      // launcher 缺失（~/.neeko/ 无 jar）：通知下载（含 Maven Central URL），
      // 不启动任务会话；running 占位被清除（gutter 不永久进行中）。
      mockInvoke.mockResolvedValue(false);
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/test/java/com/example/CalculatorTest.java',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'testAdd', line: 4, lang: 'java' },
        }),
      );

      await waitFor(() =>
        expect(useNotificationStore.getState().notifications.length).toBeGreaterThan(0),
      );
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockStartJavaAttach).not.toHaveBeenCalled();
      expect(
        useNotificationStore
          .getState()
          .notifications.some((n) => n.message.includes('junit-platform-console-standalone')),
      ).toBe(true);
    });
  });
  describe('run result stream (libtest JSON / vitest report → testResults store)', () => {
    beforeEach(() => {
      useTestResultsStore.setState({ files: {}, versions: {} });
    });

    it('should_warn_when_command_succeeds_but_no_case_matched', async () => {
      // 静默失败治理：exit 0 但 target/过滤器不覆盖该用例（examples/、自定义 `[[test]]`
      // path、test=false 目标、名称未对齐）→ 必须显式告警并附命令，而不是只清 running。
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

      const opts = mockStart.mock.calls[0][0];
      opts.onOutput('   Compiling neeko v0.1.0 (/tmp/proj)\nrunning 0 tests\n');
      opts.onExit(0);

      await waitFor(() =>
        expect(
          useNotificationStore.getState().notifications.some((n) => n.title === 'Test Run'),
        ).toBe(true),
      );
      const warning = useNotificationStore
        .getState()
        .notifications.find((n) => n.title === 'Test Run');
      expect(warning?.message).toContain('parse_simple');
      // 告警附实际命令（用户据此自助排查 target/过滤器）
      expect(warning?.message).toContain("cargo test 'parse_simple'");
      // 未命中的用例不落状态（不猜状态）
      expect(statusForCase('proj-1', 'src/lib.rs', 'parse_simple')).toBeNull();
    });

    it('Go benchmark：包级终态收口 → 落 ✓ 且不触发「零命中」告警（P2 × P0 联动）', async () => {
      // benchmark 的 test2json 无 per-benchmark 终态事件（只有 run + 包级 pass）——
      // 若解析器不收口，matched=0 会被 P0 的零命中告警误判为「过滤器/target 不覆盖」。
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'BenchmarkAdd', line: 4, lang: 'go', kind: 'benchmark' },
        }),
      );
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      // 命令形态：-run 置空 + -bench 锚定 + -count=1
      expect(mockStart.mock.calls[0][0].command).toContain("-bench '^BenchmarkAdd$' -count=1");

      const opts = mockStart.mock.calls[0][0];
      const line = (o: Record<string, unknown>) => JSON.stringify(o);
      opts.onOutput(
        [
          line({ Action: 'run', Package: 'math', Test: 'BenchmarkAdd' }),
          line({
            Action: 'output',
            Package: 'math',
            Test: 'BenchmarkAdd',
            Output: 'BenchmarkAdd-10   \t1000000000\t         0.2383 ns/op\n',
          }),
          line({ Action: 'pass', Package: 'math', Elapsed: 0.787 }),
        ].join('\n'),
      );
      opts.onExit(0);

      await waitFor(() =>
        expect(statusForCase('proj-1', 'pkg/math/add_test.go', 'BenchmarkAdd')?.status).toBe(
          'passed',
        ),
      );
      expect(
        useNotificationStore.getState().notifications.some((n) => n.title === 'Test Run'),
      ).toBe(false);
    });

    it('should_not_warn_when_run_failed_to_compile', async () => {
      // 编译失败（exit != 0）已有 Task Console 错误输出 → 不重复告警
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

      const opts = mockStart.mock.calls[0][0];
      opts.onOutput('error[E0432]: unresolved import `foo`\n');
      opts.onExit(101);

      await waitFor(() => expect(statusForCase('proj-1', 'src/lib.rs', 'parse_simple')).toBeNull());
      expect(
        useNotificationStore.getState().notifications.some((n) => n.title === 'Test Run'),
      ).toBe(false);
    });

    it('should_begin_run_before_spawn_and_land_libtest_result_on_exit', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );
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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );
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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );
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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/a.test.ts',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({ kind: 'test', testCase: { name: 'adds', line: 2, lang: 'ts' } }),
      );
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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/a.test.ts',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({ kind: 'test', testCase: { name: 'adds', line: 2, lang: 'ts' } }),
      );
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      mockStart.mock.calls[0][0].onExit(1);

      await waitFor(() => expect(statusForCase('proj-1', 'src/a.test.ts', 'adds')).toBeNull());
    });

    it('should_invalidate_running_marker_when_task_fails_to_start', async () => {
      mockStart.mockRejectedValue(new Error('spawn failed'));
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

      await waitFor(() => expect(statusForCase('proj-1', 'src/lib.rs', 'parse_simple')).toBeNull());
    });

    it('should_land_go_test2json_status_on_exit_for_go_cases', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'TestAdd', line: 3, lang: 'go' },
        }),
      );
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

    it('Go 子测试发现：运行父用例 → 发现的子测试全名入 store（P3 动态子测试）', async () => {
      // test2json 在子测试真正执行时报其 `Test` 全名（`<父>/<层级>`）→ 运行父用例
      // 即完成一次动态发现；父级状态仍按源码 fn 名对齐，子测试事件不污染 cases。
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'TestTable', line: 3, lang: 'go' },
        }),
      );
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

      const opts = mockStart.mock.calls[0][0];
      const line = (o: Record<string, unknown>) => JSON.stringify(o);
      opts.onOutput(
        [
          line({ Action: 'run', Package: 'math', Test: 'TestTable' }),
          line({ Action: 'run', Package: 'math', Test: 'TestTable/zero' }),
          line({ Action: 'pass', Package: 'math', Test: 'TestTable/zero' }),
          line({ Action: 'run', Package: 'math', Test: 'TestTable/positive' }),
          line({ Action: 'pass', Package: 'math', Test: 'TestTable/positive' }),
          line({ Action: 'pass', Package: 'math', Test: 'TestTable', Elapsed: 0.003 }),
        ].join('\n'),
      );
      opts.onExit(0);

      await waitFor(() =>
        expect(subtestsForCase('proj-1', 'pkg/math/add_test.go', 'TestTable')).toEqual([
          'TestTable/positive',
          'TestTable/zero',
        ]),
      );
      // 父级状态按源码名对齐；子测试不进 cases（无对应源码行）
      expect(statusForCase('proj-1', 'pkg/math/add_test.go', 'TestTable')?.status).toBe('passed');
      expect(statusForCase('proj-1', 'pkg/math/add_test.go', 'TestTable/zero')).toBeNull();
    });

    it('Go 子测试发现：benchmark 目标不产出子测试（b.Run 归 P2 基准语义，不在本期范围）', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'BenchmarkAdd', line: 4, lang: 'go', kind: 'benchmark' },
        }),
      );
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

      const opts = mockStart.mock.calls[0][0];
      const line = (o: Record<string, unknown>) => JSON.stringify(o);
      opts.onOutput(
        [
          line({ Action: 'run', Package: 'math', Test: 'BenchmarkAdd' }),
          line({ Action: 'run', Package: 'math', Test: 'BenchmarkAdd/x' }),
          line({ Action: 'pass', Package: 'math', Elapsed: 0.5 }),
        ].join('\n'),
      );
      opts.onExit(0);

      await waitFor(() =>
        expect(subtestsForCase('proj-1', 'pkg/math/add_test.go', 'BenchmarkAdd')).toEqual([]),
      );
    });

    it('should_clear_go_running_state_when_output_has_no_test2json_events', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'TestAdd', line: 3, lang: 'go' },
        }),
      );
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

      const opts = mockStart.mock.calls[0][0];
      opts.onOutput('go: cannot find main module\n');
      opts.onExit(1);

      await waitFor(() =>
        expect(statusForCase('proj-1', 'pkg/math/add_test.go', 'TestAdd')).toBeNull(),
      );
    });

    it('should_read_junit_xml_after_exit_and_land_passed_status_for_java_cases', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.CalculatorTest" tests="3" failures="1" errors="0" skipped="1" time="0.023">
  <testcase name="testAdd" classname="com.example.CalculatorTest" time="0.002"/>
  <testcase name="testFail" classname="com.example.CalculatorTest" time="0.001">
    <failure message="expected 2 to be 3">stack</failure>
  </testcase>
  <testcase name="testSkip" classname="com.example.CalculatorTest" time="0.0">
    <skipped/>
  </testcase>
</testsuite>`;
      mockInvoke.mockImplementation((cmd: string, args: { path?: string; filePath?: string }) => {
        if (
          cmd === 'file_exists' &&
          String(args.path ?? '').includes('.neeko/junit-platform-console-standalone')
        ) {
          return Promise.resolve(true); // launcher 就绪 → 走真实命令构造路径
        }
        if (cmd === 'file_exists' && String(args.path ?? '').endsWith('.class')) {
          return Promise.resolve(true); // 用例类已编译 → 通过编译产物预检
        }
        return cmd === 'read_file_content' &&
          args.filePath === '.neeko/junit-reports/TEST-com.example.CalculatorTest.xml'
          ? Promise.resolve({ path: 'x', content: xml, size: 1, is_binary: false })
          : Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/test/java/com/example/CalculatorTest.java',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'testAdd', line: 4, lang: 'java' },
        }),
      );
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      // spawn 前 beginRun：running 占位
      expect(
        statusForCase('proj-1', 'src/test/java/com/example/CalculatorTest.java', 'testAdd'),
      ).toEqual({ status: 'running' });

      const opts = mockStart.mock.calls[0][0];
      opts.onOutput('... JUnit console text ...\n');
      opts.onExit(0);

      await waitFor(() =>
        expect(
          statusForCase('proj-1', 'src/test/java/com/example/CalculatorTest.java', 'testAdd'),
        ).toEqual({ status: 'passed', duration: 2 }),
      );
      // 报告经 run 根相对路径读取（rootPath = run cwd）
      expect(mockInvoke).toHaveBeenCalledWith('read_file_content', {
        projectId: 'proj-1',
        filePath: '.neeko/junit-reports/TEST-com.example.CalculatorTest.xml',
        rootPath: '/tmp/proj',
      });
      // 未命中的用例不落状态（testFail/testSkip 与运行用例 testAdd 不同名）
      expect(
        statusForCase('proj-1', 'src/test/java/com/example/CalculatorTest.java', 'testFail'),
      ).toBeNull();
    });

    it('should_land_failed_status_with_message_from_junit_failure_child', async () => {
      const xml = `<testsuite name="com.example.CalculatorTest" tests="1" failures="1" time="0.001">
  <testcase name="testFail" classname="com.example.CalculatorTest" time="0.001">
    <failure message="expected 2 to be 3">org.opentest4j.AssertionFailedError</failure>
  </testcase>
</testsuite>`;
      mockInvoke.mockImplementation((cmd: string, args: { path?: string; filePath?: string }) => {
        if (
          cmd === 'file_exists' &&
          String(args.path ?? '').includes('.neeko/junit-platform-console-standalone')
        ) {
          return Promise.resolve(true); // launcher 就绪 → 走真实命令构造路径
        }
        if (cmd === 'file_exists' && String(args.path ?? '').endsWith('.class')) {
          return Promise.resolve(true); // 用例类已编译 → 通过编译产物预检
        }
        return cmd === 'read_file_content' &&
          args.filePath?.includes('TEST-com.example.CalculatorTest.xml')
          ? Promise.resolve({ path: 'x', content: xml, size: 1, is_binary: false })
          : Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/test/java/com/example/CalculatorTest.java',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'testFail', line: 7, lang: 'java' },
        }),
      );
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

      mockStart.mock.calls[0][0].onExit(1); // 失败用例 → 退出码非 0，报告仍写

      await waitFor(() =>
        expect(
          statusForCase('proj-1', 'src/test/java/com/example/CalculatorTest.java', 'testFail'),
        ).toEqual({
          status: 'failed',
          duration: 1,
          message: 'expected 2 to be 3',
        }),
      );
    });

    it('should_clear_java_running_state_when_report_read_fails', async () => {
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (
          cmd === 'file_exists' &&
          String(args.path ?? '').includes('.neeko/junit-platform-console-standalone')
        ) {
          return Promise.resolve(true); // launcher 就绪 → 走真实命令构造路径
        }
        if (cmd === 'file_exists' && String(args.path ?? '').endsWith('.class')) {
          return Promise.resolve(true); // 用例类已编译 → 通过编译产物预检
        }
        return cmd === 'read_file_content'
          ? Promise.reject(new Error('missing'))
          : Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/test/java/com/example/CalculatorTest.java',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.handleRun({
          kind: 'test',
          testCase: { name: 'testAdd', line: 4, lang: 'java' },
        }),
      );
      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      mockStart.mock.calls[0][0].onExit(1);

      await waitFor(() =>
        expect(
          statusForCase('proj-1', 'src/test/java/com/example/CalculatorTest.java', 'testAdd'),
        ).toBeNull(),
      );
    });
  });
  describe('main 入口运行（gutter main-run 按钮）', () => {
    it('Go：go run 包目录进 Task Console', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'cmd/agent/main.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleRun({ kind: 'main', entry: { line: 3, language: 'go' } }));

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(mockStart.mock.calls[0][0].command).toBe("go run './cmd/agent'");
      expect(mockStart.mock.calls[0][0].cwd).toBe('/tmp/proj');
      expect(useTaskStore.getState().consoleSessions).toHaveLength(1);
    });

    it('Go：canonical 绝对 filePath（生产形态）仍解析出包目录', async () => {
      // FileEditor 传 tab.filePath —— 恒为 canonical 绝对；探测须剥 runRoot 前缀，
      // 否则产出 `./tmp/proj/cmd/agent` 伪包路径 → go run 秒失败。
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) =>
        Promise.resolve(cmd === 'file_exists' && args?.path === '/tmp/proj/go.mod'),
      );
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: '/tmp/proj/cmd/agent/main.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleRun({ kind: 'main', entry: { line: 3, language: 'go' } }));

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(mockStart.mock.calls[0][0].command).toBe("go run './cmd/agent'");
      expect(mockStart.mock.calls[0][0].cwd).toBe('/tmp/proj');
    });

    it('Rust：cargo run 进 Task Console（cwd = run 根）', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/main.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleRun({ kind: 'main', entry: { line: 1, language: 'rust' } }));

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(mockStart.mock.calls[0][0].command).toBe('cargo run');
      expect(mockStart.mock.calls[0][0].cwd).toBe('/tmp/proj');
    });

    it('Java：java -cp target 输出 + FQCN 进 Task Console', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/main/java/com/example/App.java',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleRun({ kind: 'main', entry: { line: 4, language: 'java' } }));

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(mockStart.mock.calls[0][0].command).toBe(
        "java -cp '/tmp/proj/target/classes:/tmp/proj/target/test-classes' com.example.App",
      );
      expect(mockStart.mock.calls[0][0].cwd).toBe('/tmp/proj');
    });

    it('Java：未编译时阻断并通知，不启动任务会话', async () => {
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (
          cmd === 'file_exists' &&
          String(args?.path ?? '').includes('.neeko/junit-platform-console-standalone')
        )
          return Promise.resolve(true);
        return Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/main/java/com/example/App.java',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleRun({ kind: 'main', entry: { line: 4, language: 'java' } }));

      await waitFor(() =>
        expect(
          useNotificationStore.getState().notifications.some((n) => n.title === 'Java Run'),
        ).toBe(true),
      );
      expect(mockStart).not.toHaveBeenCalled();
    });
  });

  describe('main 入口调试（handleDebug）', () => {
    it('Go：go build 产物 → dlv exec（mode:exec）', async () => {
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (
          cmd === 'debug_build_test_binary' &&
          (args as { command?: string })?.command?.includes('go build')
        ) {
          return Promise.resolve({ exit_code: 0, stdout: 'built' });
        }
        return Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'cmd/agent/main.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebug({ kind: 'main', entry: { line: 3, language: 'go' } }));

      await waitFor(() => expect(mockStartWithConfig).toHaveBeenCalledTimes(1));
      expect(mockStartWithConfig).toHaveBeenCalledWith('proj-1', {
        name: 'Debug main',
        type: 'go',
        request: 'launch',
        program: '/tmp/proj/.neeko/test-bin/main',
        cwd: '/tmp/proj',
        mode: 'exec',
        args: [],
        stopOnEntry: false,
      });
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('Go：canonical 绝对 filePath（生产形态）→ go build 包目录正确', async () => {
      // 回归：`codeant` 实测 —— 绝对路径未剥根时构建命令为
      // `go build … './Users/…/cmd/agent'`，go 秒失败（main 构建失败）。
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string; command?: string }) => {
        if (cmd === 'debug_build_test_binary' && args?.command?.includes('go build')) {
          return Promise.resolve({ exit_code: 0, stdout: 'built' });
        }
        if (cmd === 'file_exists') return Promise.resolve(args?.path === '/tmp/proj/go.mod');
        return Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: '/tmp/proj/cmd/agent/main.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebug({ kind: 'main', entry: { line: 3, language: 'go' } }));

      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('debug_build_test_binary', {
          projectId: 'proj-1',
          command: "go build -o '.neeko/test-bin/main' -gcflags 'all=-N -l' './cmd/agent'",
          cwd: '/tmp/proj',
        }),
      );
      await waitFor(() => expect(mockStartWithConfig).toHaveBeenCalledTimes(1));
      expect(mockStartWithConfig).toHaveBeenCalledWith('proj-1', {
        name: 'Debug main',
        type: 'go',
        request: 'launch',
        program: '/tmp/proj/.neeko/test-bin/main',
        cwd: '/tmp/proj',
        mode: 'exec',
        args: [],
        stopOnEntry: false,
      });
    });

    it('Go：构建报错只在 stderr 时也落 DebugPanel console', async () => {
      // go 的构建报错全在 stderr（stdout 为空）——只回 stdout 时 console 里只有
      // "构建失败"、没有任何证据，失败原因完全不可见。
      mockInvoke.mockImplementation((cmd: string) =>
        cmd === 'debug_build_test_binary'
          ? Promise.resolve({
              exit_code: 1,
              stdout: '',
              stderr: 'stat /tmp/proj/tmp/proj/cmd/agent: directory not found\n',
            })
          : Promise.resolve(false),
      );
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: '/tmp/proj/cmd/agent/main.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebug({ kind: 'main', entry: { line: 3, language: 'go' } }));

      await waitFor(() =>
        expect(useNotificationStore.getState().notifications.some((n) => n.title === 'Debug')).toBe(
          true,
        ),
      );
      expect(mockPushConsole).toHaveBeenCalledWith(
        'err',
        expect.stringContaining('directory not found'),
      );
      expect(mockStartWithConfig).not.toHaveBeenCalled();
    });

    it('Rust：cargo build artifact 解析 → lldb launch', async () => {
      const artifact = JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/tmp/proj/src/main.rs' },
        profile: { test: false },
        executable: '/tmp/proj/target/debug/app',
      });
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (
          cmd === 'debug_build_test_binary' &&
          (args as { command?: string })?.command?.includes('cargo build')
        ) {
          return Promise.resolve({ exit_code: 0, stdout: artifact });
        }
        return Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/main.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebug({ kind: 'main', entry: { line: 1, language: 'rust' } }));

      await waitFor(() => expect(mockStartWithConfig).toHaveBeenCalledTimes(1));
      expect(mockStartWithConfig).toHaveBeenCalledWith('proj-1', {
        name: 'Debug main',
        type: 'lldb',
        request: 'launch',
        program: '/tmp/proj/target/debug/app',
        cwd: '/tmp/proj',
        args: [],
        stopOnEntry: false,
      });
    });

    it('Java：编译产物预检通过 → startJavaAttach（jdwp 命令）', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/main/java/com/example/App.java',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebug({ kind: 'main', entry: { line: 4, language: 'java' } }));

      await waitFor(() => expect(mockStartJavaAttach).toHaveBeenCalledTimes(1));
      expect(mockStartJavaAttach).toHaveBeenCalledWith(
        'proj-1',
        'java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0' +
          " -cp '/tmp/proj/target/classes:/tmp/proj/target/test-classes' com.example.App",
        '/tmp/proj',
        'main',
      );
    });

    it('Java：未编译时阻断并通知，不启动会话', async () => {
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (
          cmd === 'file_exists' &&
          String(args?.path ?? '').includes('.neeko/junit-platform-console-standalone')
        )
          return Promise.resolve(true);
        return Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/main/java/com/example/App.java',
          projectPath: '/tmp/proj',
        }),
      );

      act(() => result.current.handleDebug({ kind: 'main', entry: { line: 4, language: 'java' } }));

      await waitFor(() => expect(mockStartJavaAttach).not.toHaveBeenCalled());
      expect(useNotificationStore.getState().notifications.some((n) => n.title === 'Debug')).toBe(
        true,
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
      renderHook(() => useRunActions({ projectId: 'proj-1', filePath, projectPath: '/tmp/proj' }));

    const notifiedWith = (part: string) =>
      useNotificationStore.getState().notifications.some((n) => n.message.includes(part));

    it('should_open_debug_panel_pending_and_build_headless_without_task_session', async () => {
      mockHeadlessBuild(
        artifactOutput('/tmp/proj/src/lib.rs', '/tmp/proj/target/debug/deps/neeko-abc123'),
      );
      const { result } = renderDebugHook();

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

      // pending：点击瞬间 DebugPanel 打开（console tab + 构建中提示），Task Console 永不参与
      await waitFor(() => expect(mockOpenDebugPanel).toHaveBeenCalledWith('console'));
      expect(mockPushConsole).toHaveBeenCalledWith('sys', expect.stringContaining('Building'));
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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src-tauri/src/agent/chat/adapter/serve.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src-tauri/src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

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

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );
      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

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

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

      await waitFor(() => expect(notifiedWith('Build failed')).toBe(true));
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

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

      await waitFor(() => expect(notifiedWith('No unique test binary')).toBe(true));
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

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

      await waitFor(() => expect(notifiedWith('Multiple test binaries')).toBe(true));
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

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

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

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
        }),
      );

      await waitFor(() => expect(mockStartWithConfig).toHaveBeenCalledTimes(1));
      // launchSession 错误路径已通知，此处不重复
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it('should_ignore_debug_for_ts_cases', async () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/a.test.ts',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'adds', line: 2, lang: 'ts' },
        }),
      );
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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'TestAdd', line: 3, lang: 'go' },
        }),
      );

      // pending：DebugPanel 打开，Task Console 永不参与
      await waitFor(() => expect(mockOpenDebugPanel).toHaveBeenCalledWith('console'));
      expect(mockPushConsole).toHaveBeenCalledWith('sys', expect.stringContaining('Building'));
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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'TestAdd', line: 3, lang: 'go' },
        }),
      );

      await waitFor(() => expect(notifiedWith('Build failed')).toBe(true));
      expect(mockStartWithConfig).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockPushConsole).toHaveBeenCalledWith('err', expect.stringContaining('undefined'));
    });

    it('should_build_go_test_binary_from_canonical_absolute_file_path', async () => {
      // 生产形态：tab.filePath 为 canonical 绝对 → 包目录仍须是 `./pkg/math`。
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (cmd === 'debug_build_test_binary') return Promise.resolve({ exit_code: 0, stdout: '' });
        if (cmd === 'file_exists') return Promise.resolve(args?.path === '/tmp/proj/go.mod');
        return Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: '/tmp/proj/pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'TestAdd', line: 3, lang: 'go' },
        }),
      );

      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('debug_build_test_binary', {
          projectId: 'proj-1',
          command: "go test -c -o '.neeko/test-bin/TestAdd' -gcflags 'all=-N -l' './pkg/math'",
          cwd: '/tmp/proj',
        }),
      );
    });
  });

  describe('debug (Java → attach-first: spawn JVM + JavaAdapter attach)', () => {
    const renderJavaDebugHook = () =>
      renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/test/java/com/example/CalculatorTest.java',
          projectPath: '/tmp/proj',
        }),
      );

    it('should_call_startJavaAttach_with_jdwp_command_after_pending_panel', async () => {
      const { result } = renderJavaDebugHook();

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'testAdd', line: 4, lang: 'java' },
        }),
      );

      // pending：DebugPanel 打开 + 启动 JVM 提示
      await waitFor(() => expect(mockOpenDebugPanel).toHaveBeenCalledWith('console'));
      expect(mockPushConsole).toHaveBeenCalledWith('sys', expect.stringContaining('Java test JVM'));

      // attach-first：单条后端命令承载 spawn JVM + attach 全流程，无无头构建
      await waitFor(() => expect(mockStartJavaAttach).toHaveBeenCalledTimes(1));
      expect(mockStartJavaAttach).toHaveBeenCalledWith(
        'proj-1',
        'java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0' +
          " -jar '/Users/tester/.neeko/junit-platform-console-standalone-1.14.4.jar'" +
          " --class-path='/tmp/proj/target/classes:/tmp/proj/target/test-classes'" +
          " -m 'com.example.CalculatorTest#testAdd' --reports-dir='/tmp/proj/.neeko/junit-reports'",
        '/tmp/proj',
        'testAdd',
      );
      // 不触发无头构建（debug_build_test_binary 仅用于 mvn classpath 生成；无 pom 时零调用）
      expect(mockInvoke.mock.calls.some((c) => c[0] === 'debug_build_test_binary')).toBe(false);
      // 不触发任务会话
      expect(mockStart).not.toHaveBeenCalled();
      expect(useTaskStore.getState().consoleSessions).toHaveLength(0);
    });

    it('should_worktree_cwd_when_worktree_active', async () => {
      mockActiveWorktreePath.value = '/tmp/wt/neeko';
      const { result } = renderJavaDebugHook();

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'testAdd', line: 4, lang: 'java' },
        }),
      );

      await waitFor(() => expect(mockStartJavaAttach).toHaveBeenCalledTimes(1));
      // cwd = worktree 根（Run 语义一致）；reports-dir 也落在 worktree 下
      expect(mockStartJavaAttach).toHaveBeenCalledWith(
        'proj-1',
        expect.stringContaining("--reports-dir='/tmp/wt/neeko/.neeko/junit-reports'"),
        '/tmp/wt/neeko',
        'testAdd',
      );
    });

    it('should_not_duplicate_notification_when_java_attach_start_fails', async () => {
      mockStartJavaAttach.mockRejectedValue(new Error('host jar missing'));
      const { result } = renderJavaDebugHook();

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'testAdd', line: 4, lang: 'java' },
        }),
      );

      await waitFor(() => expect(mockStartJavaAttach).toHaveBeenCalledTimes(1));
      // launchSession 错误路径已通知，此处不重复
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it('should_use_module_root_for_multimodule_layout', async () => {
      // 多模块工程：最近 pom.xml 在 learning-algorithm/ → cwd/classpath/reports 全按模块根
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        const p = String(args?.path ?? '');
        if (cmd === 'file_exists' && p.includes('.neeko/junit-platform-console-standalone'))
          return Promise.resolve(true);
        if (cmd === 'file_exists' && p === '/tmp/proj/learning-algorithm/pom.xml')
          return Promise.resolve(true);
        if (
          cmd === 'file_exists' &&
          p ===
            '/tmp/proj/learning-algorithm/target/test-classes/com/tomgs/algorithm/base/BaseTest.class'
        )
          return Promise.resolve(true);
        return Promise.resolve(false);
      });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'learning-algorithm/src/main/java/com/tomgs/algorithm/base/BaseTest.java',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'test0', line: 10, lang: 'java' },
        }),
      );

      await waitFor(() => expect(mockStartJavaAttach).toHaveBeenCalledTimes(1));
      expect(mockStartJavaAttach).toHaveBeenCalledWith(
        'proj-1',
        'java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0' +
          " -jar '/Users/tester/.neeko/junit-platform-console-standalone-1.14.4.jar'" +
          " --class-path='/tmp/proj/learning-algorithm/target/classes:/tmp/proj/learning-algorithm/target/test-classes'" +
          " -m 'com.tomgs.algorithm.base.BaseTest#test0'" +
          " --reports-dir='/tmp/proj/learning-algorithm/.neeko/junit-reports'",
        '/tmp/proj/learning-algorithm',
        'test0',
      );
    });

    it('should_block_attach_with_guidance_when_class_uncompiled', async () => {
      // target/ 下无 class 产物 → 不启动会话（避免 Debug 面板永久 running），指引先编译
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (
          cmd === 'file_exists' &&
          String(args?.path ?? '').includes('.neeko/junit-platform-console-standalone')
        )
          return Promise.resolve(true);
        return Promise.resolve(false);
      });
      const { result } = renderJavaDebugHook();

      act(() =>
        result.current.handleDebug({
          kind: 'test',
          testCase: { name: 'testAdd', line: 4, lang: 'java' },
        }),
      );

      await waitFor(() =>
        expect(mockPushConsole).toHaveBeenCalledWith(
          'err',
          expect.stringContaining('test-compile'),
        ),
      );
      expect(mockStartJavaAttach).not.toHaveBeenCalled();
      expect(
        useNotificationStore
          .getState()
          .notifications.some((n) => n.message.includes('test-compile')),
      ).toBe(true);
    });
  });

  describe('menu (rust gutter click → Run/Debug dropdown)', () => {
    beforeEach(() => {
      useOverlayStore.getState().reset();
    });

    it('openMenu_stores_case_with_click_position_and_reports_overlay_open', () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );
      const testCase = { name: 'parse_simple', line: 1, lang: 'rust' as const };

      act(() => result.current.openMenu({ kind: 'test', testCase }, 120, 88));

      expect(result.current.menu).toEqual({ target: { kind: 'test', testCase }, x: 120, y: 88 });
      // z-order 惯例：菜单打开期间占用 overlay 计数
      expect(useOverlayStore.getState().open['editor-run-menu']).toBe(true);
    });

    it('menu_shows_run_and_debug_labeled_with_test_name_for_rust_cases', () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'parse_simple', line: 1, lang: 'rust' } },
          10,
          20,
        ),
      );

      const items = result.current.menuItems;
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ label: "Test 'parse_simple'" });
      expect(items[1]).toMatchObject({ label: "Debug 'Test parse_simple'" });
    });

    it('menu_labels_follow_the_opened_case_name', () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'other_case', line: 3, lang: 'rust' } },
          10,
          20,
        ),
      );

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
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'parse_simple', line: 1, lang: 'rust' } },
          10,
          20,
        ),
      );

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

    it('main 入口复用同一菜单：Run/Debug 带描述文案', () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'cmd/agent/main.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.openMenu({ kind: 'main', entry: { line: 3, language: 'go' } }, 10, 20),
      );

      expect(result.current.menu?.target).toEqual({
        kind: 'main',
        entry: { line: 3, language: 'go' },
      });
      const items = result.current.menuItems;
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ label: "Run 'main'" });
      expect(items[1]).toMatchObject({ label: "Debug 'main'" });

      // Run → go run 进 Task Console
      act(() => items[0].action());
      waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    });

    it('menu_lists_discovered_subtests_for_go_cases_after_a_separator', () => {
      useTestResultsStore.setState({ files: {}, versions: {} });
      useTestResultsStore
        .getState()
        .recordSubtests('proj-1', 'pkg/math/add_test.go', 'TestTable', [
          'TestTable/positive',
          'TestTable/zero',
        ]);
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'TestTable', line: 3, lang: 'go' } },
          10,
          20,
        ),
      );

      const items = result.current.menuItems;
      expect(items).toHaveLength(7);
      expect(items[0]).toMatchObject({ label: "Test 'TestTable'" });
      expect(items[1]).toMatchObject({ label: "Debug 'Test TestTable'" });
      expect(items[2]).toEqual({ separator: true });
      // 每个子测试成对给出 Run + Debug（与父用例同构：Run 在前、Debug 在后）
      expect(items[3]).toMatchObject({ label: "Test 'TestTable/positive'" });
      expect(items[4]).toMatchObject({ label: "Debug 'Test TestTable/positive'" });
      expect(items[5]).toMatchObject({ label: "Test 'TestTable/zero'" });
      expect(items[6]).toMatchObject({ label: "Debug 'Test TestTable/zero'" });
    });

    it('subtest_debug_builds_and_launches_delve_against_the_sanitized_binary', async () => {
      useTestResultsStore.setState({ files: {}, versions: {} });
      useTestResultsStore
        .getState()
        .recordSubtests('proj-1', 'pkg/math/add_test.go', 'TestTable', ['TestTable/zero']);

      const buildCommands: string[] = [];
      mockInvoke.mockImplementation((cmd: string, invArgs: { command?: string }) => {
        if (cmd === 'debug_build_test_binary') {
          buildCommands.push(invArgs.command ?? '');
          return Promise.resolve({ exit_code: 0, stdout: '', stderr: '' });
        }
        return Promise.resolve(false); // go.mod 探测未命中 → 回退文件所在目录包路径
      });

      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'TestTable', line: 3, lang: 'go' } },
          10,
          20,
        ),
      );

      const debugItem = result.current.menuItems[4];
      if (debugItem.separator === true) throw new Error('expected a subtest Debug item at index 4');
      expect(debugItem.label).toBe("Debug 'Test TestTable/zero'");
      act(() => debugItem.action());

      await waitFor(() => expect(mockStartWithConfig).toHaveBeenCalledTimes(1));
      const config = mockStartWithConfig.mock.calls[0][1];
      // 层级锚定 -test.run：dlv exec 只跑该子测试（真机 dlv 1.27 + marker 文件实证）
      expect(config.args).toEqual(['^TestTable$/^zero$']);
      expect(config).toMatchObject({ type: 'go', mode: 'exec', cwd: '/tmp/proj' });
      // program 指向 `-o` 产物；原始名含 `/` → 文件名已消毒，不再落嵌套目录
      expect(config.program).toMatch(/\/tmp\/proj\/\.neeko\/test-bin\/TestTable_zero-[0-9a-f]{8}$/);
      expect(buildCommands[0]).toContain("-o '.neeko/test-bin/TestTable_zero-");
    });

    it('subtest_debug_reports_build_failure_without_starting_a_session', async () => {
      useTestResultsStore.setState({ files: {}, versions: {} });
      useTestResultsStore
        .getState()
        .recordSubtests('proj-1', 'pkg/math/add_test.go', 'TestTable', ['TestTable/zero']);
      mockInvoke.mockImplementation((cmd: string) =>
        Promise.resolve(
          cmd === 'debug_build_test_binary'
            ? { exit_code: 1, stdout: '', stderr: 'cannot find package' }
            : false,
        ),
      );

      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'TestTable', line: 3, lang: 'go' } },
          10,
          20,
        ),
      );
      const debugItem = result.current.menuItems[4];
      if (debugItem.separator === true) throw new Error('expected a subtest Debug item at index 4');
      act(() => debugItem.action());

      await waitFor(() => expect(mockPushConsole).toHaveBeenCalledWith('err', expect.anything()));
      expect(mockStartWithConfig).not.toHaveBeenCalled();
    });

    it('subtest_item_runs_the_single_subtest_with_a_hierarchically_anchored_filter', async () => {
      useTestResultsStore.setState({ files: {}, versions: {} });
      useTestResultsStore
        .getState()
        .recordSubtests('proj-1', 'pkg/math/add_test.go', 'TestTable', ['TestTable/with.dot']);
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );
      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'TestTable', line: 3, lang: 'go' } },
          10,
          20,
        ),
      );

      const subItem = result.current.menuItems[3];
      if (subItem.separator === true) throw new Error('expected a subtest menu item at index 3');
      act(() => subItem.action());

      await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
      expect(mockStart.mock.calls[0][0].command).toBe(
        "go test -run '^TestTable$/^\\Qwith.dot\\E$' -json './pkg/math'",
      );
      // 单跑子测试同样落父用例的「运行中」占位（源码行只对应父用例）
      expect(statusForCase('proj-1', 'pkg/math/add_test.go', 'TestTable')).toEqual({
        status: 'running',
      });
    });

    it('menu_omits_the_subtest_section_when_nothing_was_discovered', () => {
      useTestResultsStore.setState({ files: {}, versions: {} });
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'pkg/math/add_test.go',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'TestTable', line: 3, lang: 'go' } },
          10,
          20,
        ),
      );

      expect(result.current.menuItems).toHaveLength(2);
    });

    it('menu_never_lists_subtests_for_non_go_cases', () => {
      useTestResultsStore.setState({ files: {}, versions: {} });
      // 子测试发现是 Go `t.Run` 语义；即便 store 里存在同名父级的记录，也不得外溢到其它语言
      useTestResultsStore
        .getState()
        .recordSubtests('proj-1', 'src/lib.rs', 'parse_simple', ['parse_simple/x']);
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'parse_simple', line: 1, lang: 'rust' } },
          10,
          20,
        ),
      );

      expect(result.current.menuItems).toHaveLength(2);
    });

    it('closeMenu_clears_state_and_releases_overlay', () => {
      const { result } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'parse_simple', line: 1, lang: 'rust' } },
          10,
          20,
        ),
      );
      act(() => result.current.closeMenu());

      expect(result.current.menu).toBeNull();
      expect(result.current.menuItems).toEqual([]);
      expect(useOverlayStore.getState().open['editor-run-menu']).toBe(false);
    });

    it('releases_overlay_on_unmount_while_menu_open', () => {
      const { result, unmount } = renderHook(() =>
        useRunActions({
          projectId: 'proj-1',
          filePath: 'src/lib.rs',
          projectPath: '/tmp/proj',
        }),
      );

      act(() =>
        result.current.openMenu(
          { kind: 'test', testCase: { name: 'parse_simple', line: 1, lang: 'rust' } },
          10,
          20,
        ),
      );
      unmount();

      expect(useOverlayStore.getState().open['editor-run-menu']).toBe(false);
    });
  });
});

describe('main 菜单文案', () => {
  it('Run/Debug 标签对齐单测惯例（携带目标描述）', () => {
    expect(mainRunLabel()).toBe("Run 'main'");
    expect(mainDebugLabel()).toBe("Debug 'main'");
  });
});

describe('基准菜单文案（P2）', () => {
  it("区分 benchmark 与普通用例（避免 Test 'BenchmarkAdd' 的误导）", () => {
    expect(benchmarkRunLabel('BenchmarkAdd')).toBe("Benchmark 'BenchmarkAdd'");
    expect(benchmarkDebugLabel('BenchmarkAdd')).toBe("Debug 'Benchmark BenchmarkAdd'");
  });
});
