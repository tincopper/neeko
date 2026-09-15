/**
 * runner 域的跨 feature 公开面（门面）。
 *
 * 通道约束：`runner` 已在 `.eslintrc.cjs` 的 `FEATURE_DIRS` 中（方案 B 阶段 5），防火墙
 * 只放行跨 feature 导入 `index / store / types / api` 四类路径 —— 深导
 * `@/features/runner/languages/...`、`@/features/runner/exec/...` 会被 lint 拦死。
 * 因此**本文件就是 editor 等域获取 runner 能力的唯一合法入口**。
 *
 * 组成：
 * - 公开组件（DebugRunButton / DebugPanel）—— app 层按需消费；
 * - 公开 hooks（useRunActions 等）—— editor 侧装配；
 * - **渲染能力（断点 gutter / 当前行高亮）不在此**：它们是 CodeMirror 渲染扩展，
 *   属 editor 概念，由 `features/editor` 门面导出（§10.2 边界原则）。
 *
 * 另导出 editor 渲染层消费的数据/类型符号：
 * `RunTarget` / `LspRunnable` / `TestCaseInfo` / `LineTarget`（类型）、`isRunnableFile` /
 * `isTestCaseFile` / `capabilitiesFor` / `discoverRunTargets` / `hasMainEntries` /
 * `staticSubtestsForFile` / `targetLang` / `targetLine` / `lspKey`（纯函数谓词与派生）。
 * store（`useTestResultsStore` / 测试状态函数）是直导白名单面，**不经门面**，
 * 跨域消费一律 `from '@/features/runner/store/testResults'` 直导。
 */
export { useRunActions } from './hooks/useRunActions';
export { default as DebugRunButton } from './components/DebugRunButton';
export { default as DebugPanel } from './components/DebugPanel';
export type { LaunchConfig } from './types';
export type { RunTarget } from './runTarget';
export { targetLang, targetLine } from './runTarget';
export type { LanguageOverlay, LineTarget } from './languages/contract';
export type { TestCaseInfo } from './syntax/contract';
export {
  capabilitiesFor,
  caseOverlaysFor,
  discoverRunTargets,
  hasMainEntries,
  isRunnableFile,
  isTestCaseFile,
} from './languages';
export { overlayKey, overlayProviderFor } from './languages';
