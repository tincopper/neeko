/**
 * debug 域的跨 feature 公开面（门面）。
 *
 * 通道约束：enforced 防火墙（`.eslintrc.cjs` 的 `import/no-restricted-paths`）只放行
 * 跨 feature 导入 `index / store / types / api` 四类路径 —— 深导
 * `@/features/debug/gutter/...` 会被 lint 直接拦死。因此**本文件就是 editor 等域
 * 获取 debug 能力的唯一合法入口**。
 *
 * 组成：
 * - 公开组件（DebugRunButton / DebugPanel）—— app 层按需消费；
 * - 公开 hooks（useBreakpointGutter / useCurrentLineHighlight）—— editor 侧装配；
 * - **统一 gutter 扩展面**（breakpointContribution*、setBreakpointsEffect /
 *   setHoverLineEffect、toggleBreakpointAt、hover 原语、applyDebugCurrentLine /
 *   resolveDebugHighlightLine）：editor 的 `gutter/registry` 只认
 *   `GutterContribution` 接口，具体断点贡献由 debug 提供、经此门面注入（行为回调
 *   由装配点注入，贡献本身不直连 store）。
 *
 * 维护约定：**只导出确有跨 feature 消费者的符号**（无消费者即删除，需要时再加回）。
 * 曾出现在此但已无消费者的 `DebugToolbar`、`breakpointField`、`hoverLineField`、
 * `currentLineDecoField`、`breakpointGutterTheme`、`setCurrentLineEffect`、
 * `BreakpointGutterPayload`，以及 `DapSessionInfo` / `BreakpointSpec` / `EntryPoint` /
 * `DebugPanelTab` 四个纯类型导出，均按该约定移除。
 */
export { default as DebugRunButton } from './components/DebugRunButton';
export { default as DebugPanel } from './components/DebugPanel';
export {
  setBreakpointsEffect,
  setHoverLineEffect,
  toggleBreakpointAt,
  setBreakpointHoverLine,
  clearBreakpointHoverLine,
  useBreakpointGutter,
} from './hooks/useBreakpointGutter';
export {
  breakpointContribution,
  breakpointContributionExtensions,
} from './gutter/breakpointContribution';
export {
  applyDebugCurrentLine,
  resolveDebugHighlightLine,
  useCurrentLineHighlight,
} from './hooks/useCurrentLineHighlight';
export type { LaunchConfig } from './types';
