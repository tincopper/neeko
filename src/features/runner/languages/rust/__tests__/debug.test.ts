/**
 * rust 调试 launch 配置
 */
import { describe, expect, it } from 'vitest';

import { TestCaseInfo } from '../../../syntax/contract';
import { rustMainDebugLaunchConfig, rustTestDebugLaunchConfig } from '../debug';

const rustCase: TestCaseInfo = { name: 'parse_simple', line: 1, lang: 'rust' };

describe('rustTestDebugLaunchConfig', () => {
  it('should_build_lldb_config_for_rust_cases', () => {
    expect(
      rustTestDebugLaunchConfig(rustCase, '/proj/target/debug/deps/neeko-abc', '/proj'),
    ).toEqual({
      name: 'Debug test: parse_simple',
      type: 'lldb',
      request: 'launch',
      program: '/proj/target/debug/deps/neeko-abc',
      cwd: '/proj',
      args: ['parse_simple'],
      stopOnEntry: false,
    });
  });
});

describe('rustMainDebugLaunchConfig', () => {
  it('Rust：type lldb + 无参数', () => {
    expect(rustMainDebugLaunchConfig('/tmp/proj/target/debug/app', '/tmp/proj')).toEqual({
      name: 'Debug main',
      type: 'lldb',
      request: 'launch',
      program: '/tmp/proj/target/debug/app',
      cwd: '/tmp/proj',
      args: [],
      stopOnEntry: false,
    });
  });
});
