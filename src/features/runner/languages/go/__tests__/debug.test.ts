// @vitest-environment node
/**
 * go 调试 launch 配置
 */
import { describe, expect, it } from 'vitest';

import { TestCaseInfo } from '../../../syntax/contract';
import { goMainDebugLaunchConfig, goTestDebugLaunchConfig } from '../debug';

const goCase: TestCaseInfo = { name: 'TestAdd', line: 3, lang: 'go' };

describe('goTestDebugLaunchConfig', () => {
  const benchCase: TestCaseInfo = {
    name: 'BenchmarkAdd',
    line: 4,
    lang: 'go',
    variant: 'benchmark',
  };

  it('should_build_go_exec_config_with_anchored_test_run_pattern_for_go_cases', () => {
    expect(goTestDebugLaunchConfig(goCase, '/proj/.neeko/test-bin/TestAdd', '/proj')).toEqual({
      name: 'Debug test: TestAdd',
      type: 'go',
      request: 'launch',
      program: '/proj/.neeko/test-bin/TestAdd',
      cwd: '/proj',
      mode: 'exec',
      args: ['^TestAdd$'],
      stopOnEntry: false,
    });
  });

  it('子测试目标 → args 用层级锚定模式（dlv `-test.run` 单跑该子测试）', () => {
    // 动态子测试（P3）与 Run 共用同一模式构造：避免两条链路各自拼 -test.run 而漂移。
    const subCase: TestCaseInfo = { name: 'TestTable/with.dot', line: 3, lang: 'go' };
    expect(goTestDebugLaunchConfig(subCase, '/proj/.neeko/test-bin/x', '/proj').args).toEqual([
      '^TestTable$/^\\Qwith.dot\\E$',
    ]);
  });

  it('Debug：dlv launch 传显式 -test.run/-test.bench（首参带 `-` → adapter 原样透传）', () => {
    expect(
      goTestDebugLaunchConfig(benchCase, '/proj/.neeko/test-bin/BenchmarkAdd', '/proj'),
    ).toEqual({
      name: 'Debug benchmark: BenchmarkAdd',
      type: 'go',
      request: 'launch',
      program: '/proj/.neeko/test-bin/BenchmarkAdd',
      cwd: '/proj',
      mode: 'exec',
      args: ['-test.run', '^$', '-test.bench', '^BenchmarkAdd$'],
      stopOnEntry: false,
    });
  });

  it('Debug：普通用例仍走裸锚定模式（adapter 拼 -test.run）', () => {
    expect(goTestDebugLaunchConfig(goCase, '/p/bin', '/proj').args).toEqual(['^TestAdd$']);
  });
});

describe('goMainDebugLaunchConfig', () => {
  it('Go：type go + mode exec + 无测试过滤', () => {
    expect(goMainDebugLaunchConfig('/tmp/proj/.neeko/test-bin/main', '/tmp/proj')).toEqual({
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
});
