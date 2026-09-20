/**
 * @deprecated 直接从 `./quickFixMenuRender`（菜单 DOM + 容器）或
 * `./quickFixMenuActions`（上下文 + 定位 + 派发）导入。
 *
 * F7a 纯重构垫片：原 391 行按"渲染 vs 派发"拆分，本文件只剩重导出，
 * 调用方（popup / gutter / `lspQuickFix` 装配）已改直引新模块。
 * 垫片保留一版，下个版本删除。
 */
export type { EditorMenuItem, EditorMenuSection } from './quickFixMenuRender';
export { showQuickFixMenu } from './quickFixMenuRender';
export type { LspQuickFixContext } from './quickFixMenuActions';
export {
  applyPreferredFixAt,
  diagnosticAtPosition,
  openQuickFixAt,
  runAiFixAt,
  shortcutHint,
  viewProblemAt,
} from './quickFixMenuActions';
