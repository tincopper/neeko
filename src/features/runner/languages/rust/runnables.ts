/**
 * rust-analyzer `experimental/runnables` 的**纯核心**：载荷解析 → 目标选择。
 *
 * 命令构造不放这里（`runnableToCommand` 之类在 `commands.ts`，与其它命令构造器
 * 同居一处，并复用其 `shQuote`）——本模块只描述「载荷长什么样、该选哪一项」。
 *
 * 实测依据（rust-analyzer 1.97.1，2026-09-11，真机 stock-buddy 工作区）：
 * - 响应项形如
 *   `{ label, kind: "cargo", args: { cwd, workspaceRoot, cargoArgs, executableArgs, environment, overrideCargo } }`；
 * - **不返回 `location`**（实测 0 处）→ 无法按行号区间整体映射，必须**按 position 逐目标请求**；
 * - 按测试函数位置请求会拿到含完整测试路径与 `--exact` 的确定性参数，例如
 *   `cargoArgs: ["test","--package","api","--bin","stock-buddy"]` +
 *   `executableArgs: ["routes::sentiment::tests::test_x","--exact","--nocapture","--include-ignored"]`；
 * - 同一位置会同时返回 `cargo check` / `cargo run` / `cargo test --all-targets` 等**粗粒度**项，
 *   因此必须显式选择（见 {@link selectRunnable}），不能「取第一个」。
 */

/** RA `cargo` / `shell` kind 的参数（字段名与线上载荷一致；可选字段按实测缺失情况放宽）。 */
export interface RustOverlay {
  label: string;
  kind: 'cargo' | 'shell';
  args: {
    cwd: string;
    workspaceRoot?: string;
    /** `cargo <cargoArgs…>`（如 `["test","--package","api","--bin","x"]`）。 */
    cargoArgs?: string[];
    /** `-- <executableArgs…>`（如 `["mod::tests::case","--exact"]`）。 */
    executableArgs?: string[];
    /** `kind:"shell"` 时的可执行文件。 */
    program?: string;
    /** `kind:"shell"` 时的参数。 */
    args?: string[];
    environment?: Record<string, string>;
    /** 覆盖 `cargo` 可执行文件（实测 `null` 表示不覆盖）。 */
    overrideCargo?: string | null;
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((v) => typeof v === 'string') ? (value as string[]) : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every(([, v]) => typeof v === 'string')) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * 校验 + 归一化 RA 响应（版本漂移防御）：非法项**丢弃**而不是猜测 —— 结构化数据一旦
 * 猜错就会把错误参数喂给执行。`result` 非数组 / 未知 `kind` / 缺 `cwd` 一律丢弃。
 */
export function parseRunnables(raw: unknown): RustOverlay[] {
  if (!Array.isArray(raw)) return [];
  const out: RustOverlay[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { label, kind, args } = item as Record<string, unknown>;
    if (typeof label !== 'string' || (kind !== 'cargo' && kind !== 'shell')) continue;
    if (typeof args !== 'object' || args === null) continue;
    const rawArgs = args as Record<string, unknown>;
    if (typeof rawArgs.cwd !== 'string' || rawArgs.cwd === '') continue;
    const cargoArgs = stringArray(rawArgs.cargoArgs);
    const executableArgs = stringArray(rawArgs.executableArgs);
    const environment = stringRecord(rawArgs.environment);
    const shellArgs = stringArray(rawArgs.args);
    const overrideCargo = rawArgs.overrideCargo;
    out.push({
      label,
      kind,
      args: {
        cwd: rawArgs.cwd,
        ...(typeof rawArgs.workspaceRoot === 'string'
          ? { workspaceRoot: rawArgs.workspaceRoot }
          : {}),
        ...(cargoArgs ? { cargoArgs } : {}),
        ...(executableArgs ? { executableArgs } : {}),
        ...(typeof rawArgs.program === 'string' ? { program: rawArgs.program } : {}),
        ...(shellArgs ? { args: shellArgs } : {}),
        ...(environment ? { environment } : {}),
        ...(typeof overrideCargo === 'string' || overrideCargo === null ? { overrideCargo } : {}),
      },
    });
  }
  return out;
}

/** 目标类型：测试用例（要具体到单用例）或 main 入口（要 `cargo run`）。 */
export type RunnableTarget = 'test' | 'main';

/**
 * 各目标**唯一**接受的 cargo 子命令：测试只认 `test`，main 只认 `run`。
 * 刻意不把 `cargo check` / `test --all-targets` 当作替代项 —— 选错了就是「点了按钮跑了别的东西」，
 * 宁可 `null` 让调用方回退快路径。
 */
const REQUIRED_CARGO_SUBCOMMAND: Record<RunnableTarget, string> = {
  test: 'test',
  main: 'run',
};

/** 是否「具体到单个测试」：`cargo test` 且 executableArgs 含非 flag token（完整测试路径）。 */
export function isSpecificTestRun(runnable: RustOverlay): boolean {
  if (runnable.kind !== 'cargo') return false;
  const cargoArgs = runnable.args.cargoArgs ?? [];
  if (cargoArgs[0] !== 'test') return false;
  return (runnable.args.executableArgs ?? []).some((a) => !a.startsWith('-'));
}

/**
 * 从同一位置的候选中**显式选择**执行项（实测同一位置会返回多种粒度：`check` / `run` /
 * `test --all-targets` / 具体用例）。
 *
 * 规则：子命令必须等于目标要求（见 {@link REQUIRED_CARGO_SUBCOMMAND}），否则不选；
 * 满足者按 `tier`（具体用例 / 带 `--bin` 的 `cargo run` 优先）→ 参数更具体（token 更多）
 * → 稳定保序。无合格项 → `null`（调用方回退快路径，绝不猜）。
 */
export function selectRunnable(
  runnables: readonly RustOverlay[],
  target: RunnableTarget,
): RustOverlay | null {
  const required = REQUIRED_CARGO_SUBCOMMAND[target];
  const scored: { runnable: RustOverlay; tier: number; tokens: number; index: number }[] = [];
  runnables.forEach((runnable, index) => {
    if (runnable.kind !== 'cargo') return;
    const cargoArgs = runnable.args.cargoArgs ?? [];
    if (cargoArgs[0] !== required) return;
    const specific = target === 'test' ? isSpecificTestRun(runnable) : cargoArgs.includes('--bin');
    scored.push({ runnable, tier: specific ? 0 : 1, tokens: cargoArgs.length, index });
  });
  if (scored.length === 0) return null;
  scored.sort((a, b) => a.tier - b.tier || b.tokens - a.tokens || a.index - b.index);
  return scored[0].runnable;
}
