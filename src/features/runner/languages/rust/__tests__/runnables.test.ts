import { describe, expect, it } from 'vitest';

import { isSpecificTestRun, parseRunnables, selectRunnable, type RustOverlay } from '../runnables';

/**
 * 载荷形状**取自真机实测**（rust-analyzer 1.97.1，2026-09-11，stock-buddy 工作区，
 * `experimental/runnables` 按测试函数 position 请求）—— 夹具与线上一致，避免「凭想象写类型」。
 */
const SPECIFIC_TEST: unknown = {
  label: 'cargo test -p api --bin stock-buddy -- routes::sentiment::tests::test_x --exact',
  kind: 'cargo',
  args: {
    environment: { RUSTC_TOOLCHAIN: '/Users/tomgs/.rustup/toolchains/stable-aarch64-apple-darwin' },
    cwd: '/proj/crates/api',
    overrideCargo: null,
    workspaceRoot: '/proj',
    cargoArgs: ['test', '--package', 'api', '--bin', 'stock-buddy'],
    executableArgs: [
      'routes::sentiment::tests::test_x',
      '--exact',
      '--nocapture',
      '--include-ignored',
    ],
  },
};

const COARSE_TEST: unknown = {
  label: 'cargo test -p api --all-targets',
  kind: 'cargo',
  args: {
    cwd: '/proj',
    workspaceRoot: '/proj',
    cargoArgs: ['test', '--package', 'api', '--all-targets'],
    executableArgs: [],
  },
};

const COARSE_CHECK: unknown = {
  label: 'cargo check -p api --all-targets',
  kind: 'cargo',
  args: {
    cwd: '/proj',
    workspaceRoot: '/proj',
    cargoArgs: ['check', '--package', 'api'],
    executableArgs: [],
  },
};

const MAIN_RUN: unknown = {
  label: 'cargo run -p api',
  kind: 'cargo',
  args: {
    cwd: '/proj',
    overrideCargo: null,
    workspaceRoot: '/proj',
    cargoArgs: ['run', '--package', 'api'],
    executableArgs: [],
  },
};

describe('parseRunnables', () => {
  it('解析实测载荷并归一化（保留 cargoArgs / executableArgs / cwd / environment）', () => {
    const [parsed] = parseRunnables([SPECIFIC_TEST]);
    expect(parsed.kind).toBe('cargo');
    expect(parsed.args.cargoArgs).toEqual(['test', '--package', 'api', '--bin', 'stock-buddy']);
    expect(parsed.args.executableArgs).toEqual([
      'routes::sentiment::tests::test_x',
      '--exact',
      '--nocapture',
      '--include-ignored',
    ]);
    expect(parsed.args.cwd).toBe('/proj/crates/api');
    expect(parsed.args.workspaceRoot).toBe('/proj');
    expect(parsed.args.environment?.RUSTC_TOOLCHAIN).toContain('stable-aarch64');
    expect(parsed.args.overrideCargo).toBeNull();
  });

  it('丢弃畸形项而不是猜（非数组 / 未知 kind / 缺 cwd / 字段类型错）', () => {
    const raw = [
      null,
      'not-an-object',
      { label: 'x', kind: 'maven', args: { cwd: '/p' } }, // 未知 kind
      { label: 'x', kind: 'cargo', args: { cwd: '' } }, // 空 cwd
      { label: 42, kind: 'cargo', args: { cwd: '/p' } }, // label 非串
      { label: 'keep', kind: 'cargo', args: { cwd: '/p', cargoArgs: [1, 2] } }, // 数组元素非串 → 丢弃该字段
    ];
    const parsed = parseRunnables(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].label).toBe('keep');
    expect(parsed[0].args.cargoArgs).toBeUndefined();
  });

  it('非数组输入（服务端异常 / 版本漂移）→ 空结果', () => {
    expect(parseRunnables(undefined)).toEqual([]);
    expect(parseRunnables({ result: [] })).toEqual([]);
    expect(parseRunnables('nope')).toEqual([]);
  });
});

describe('selectRunnable', () => {
  const parsed = (raw: unknown[]): RustOverlay[] => parseRunnables(raw);

  it('测试：在同一位置的多种粒度中选「具体用例」而非 check / test --all-targets', () => {
    const chosen = selectRunnable(
      parsed([COARSE_CHECK, COARSE_TEST, SPECIFIC_TEST, MAIN_RUN]),
      'test',
    );
    expect(chosen?.label).toContain('--bin stock-buddy');
    expect(isSpecificTestRun(chosen as RustOverlay)).toBe(true);
  });

  it('main：选 `cargo run`（不选 check / test）', () => {
    const chosen = selectRunnable(parsed([COARSE_CHECK, COARSE_TEST, MAIN_RUN]), 'main');
    expect(chosen?.args.cargoArgs).toEqual(['run', '--package', 'api']);
  });

  it('只有粗粒度 test（无具体用例）→ 仍可用作测试运行', () => {
    const chosen = selectRunnable(parsed([COARSE_TEST]), 'test');
    expect(chosen?.args.cargoArgs).toEqual(['test', '--package', 'api', '--all-targets']);
  });

  it('无合格子命令 → null（调用方回退快路径，绝不猜）', () => {
    expect(selectRunnable(parsed([COARSE_CHECK]), 'test')).toBeNull();
    expect(selectRunnable(parsed([COARSE_CHECK, COARSE_TEST]), 'main')).toBeNull();
    expect(selectRunnable([], 'test')).toBeNull();
  });

  it('同 tier 时参数更具体（token 更多）者优先', () => {
    const a = parseRunnables([
      { label: 'generic', kind: 'cargo', args: { cwd: '/p', cargoArgs: ['test'] } },
      {
        label: 'scoped',
        kind: 'cargo',
        args: { cwd: '/p', cargoArgs: ['test', '--package', 'api'] },
      },
    ]);
    expect(selectRunnable(a, 'test')?.label).toBe('scoped');
  });
});

describe('isSpecificTestRun', () => {
  it('仅当 cargo test + executableArgs 含非 flag token 时为真', () => {
    expect(isSpecificTestRun(parseRunnables([SPECIFIC_TEST])[0])).toBe(true);
    expect(isSpecificTestRun(parseRunnables([COARSE_TEST])[0])).toBe(false);
    expect(
      isSpecificTestRun(
        parseRunnables([
          {
            label: 'x',
            kind: 'cargo',
            args: { cwd: '/p', cargoArgs: ['test'], executableArgs: ['--exact'] },
          },
        ])[0],
      ),
    ).toBe(false);
    expect(isSpecificTestRun(parseRunnables([MAIN_RUN])[0])).toBe(false);
  });
});
