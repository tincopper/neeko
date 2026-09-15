/**
 * Rust 语言模块（`LanguageModule` 实现）。
 *
 * Rust 的三处差异集中在这里：
 * - **cargo 清单定位**：项目根无 `Cargo.toml` 时必须显式 `--manifest-path`（否则 exit 101），
 *   故 run 用 `projectPath` 探测、main 用文件向上探测（历史行为，逐字保持）；
 * - **tier ① overlay**：rust-analyzer `experimental/runnables` 给出的确定性 target/过滤参数
 *   优先于启发式（`overlay` 即该载荷，由本模块解释）；
 * - **native Debug**：无头构建 → compiler-artifact 解析 → lldb。
 */
import { runNativeDebug } from '../../exec/nativeDebug';
import { buildTestConfigId } from '../../exec/shell';
import type { LanguageModule } from '../contract';
import { defaultLabels } from '../labels';

import { buildRustMainRunCommand, buildRustRunCommand } from './commands';
import { RUST_DEBUG_HOOKS } from './debug';
import { discoverRustMains, discoverRustTests } from './discover';
import { resolveCargoManifestDir, resolveCargoManifestDirForFile } from './manifest';
import { RUST_OVERLAY_PROVIDER, rustOverlayKey } from './overlayProvider';
import { readRustResults, rustReportZeroMatch } from './results';
import type { RustOverlay } from './runnables';

/** overlay 载荷 = rust-analyzer runnable（本模块是唯一解释者）。 */
/**
 * overlay 载荷 = rust-analyzer runnable（**本模块是唯一解释者**）。
 *
 * 通用层拿到的只是 `LanguageOverlay`（不透明），只有本模块知道它长什么样 ——
 * 这正是「语言私有载荷不外泄」的落点。
 */
const asRustOverlay = (overlay: unknown): RustOverlay | null => (overlay as RustOverlay) ?? null;

export const RUST: LanguageModule = {
  id: 'rust',
  filePolicy: {
    match: (name) => name.endsWith('.rs'),
    // 测试由**内容**判定（属性 `#[test]` / `#[tokio::test]`）：`.rs` 本身也可能是 main。
    isTestCaseFile: (name, docText) =>
      name.endsWith('.rs') &&
      docText !== undefined &&
      (docText.includes('#[test]') || docText.includes('#[tokio::test')),
    hasMain: true,
  },
  discover: (sd) => ({ tests: discoverRustTests(sd), mains: discoverRustMains(sd) }),
  readResults: readRustResults,
  reportZeroMatch: rustReportZeroMatch,
  ui: { labels: defaultLabels },
  overlayProvider: RUST_OVERLAY_PROVIDER,
  overlayKey: rustOverlayKey,
  capabilities: { directRun: false, debug: 'native' },

  async planTestRun({ ctx, testCase, runRoot, overlay, io }) {
    // 清单探测基准 = 项目根（历史行为）：workspace 从根跑 `cargo test` 会编所有成员。
    const manifestDir = await resolveCargoManifestDir(ctx.projectPath ?? '', io.fileExists);
    return {
      cwd: runRoot,
      command: buildRustRunCommand(testCase, {
        manifestDir: manifestDir,
        lsp: asRustOverlay(overlay),
      }),
      configId: buildTestConfigId('run', testCase, ctx.filePath),
    };
  },

  async planMainRun({ ctx, entry, runRoot, overlay, io }) {
    const manifestDir = await resolveCargoManifestDirForFile(runRoot, ctx.filePath, io.fileExists);
    return {
      cwd: runRoot,
      command: buildRustMainRunCommand({ manifestDir, lsp: asRustOverlay(overlay) }),
      configId: `main:${entry.language}:${ctx.filePath}`,
    };
  },

  planDebug: (input) => runNativeDebug(RUST_DEBUG_HOOKS, input.target, input.ctx),
  // Rust 走 lldb 系适配器（`lldb` / `codelldb`）：安装指引由本模块给出。
  debugHooks: {
    adapterHint: () => 'Install lldb-dap (LLVM) or codelldb and ensure it is on PATH',
  },
};
