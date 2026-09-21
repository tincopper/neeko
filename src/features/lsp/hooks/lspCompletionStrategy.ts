/**
 * M4 导入策略应用段（从 `lspCompletionInfoRenderer` 拆出 —— 行数红线 <300 台账）。
 *
 * 边界：本模块只做**策略**（apply 变换 + 选中解析 + 预热）；渲染职责
 * （buildListItem / buildInfoPanel / buildModuleNodeFromCompletion）留在 renderer，
 * 主题化 info 面板的构建器以回调注入 —— 本模块不 import 渲染层。
 */
import type { LspImportStrategy } from '@/shared/types/settings';

import {
  applyImportStrategyToOption,
  getLspImportStrategy,
  type StrategyCompletionOption,
} from '../api/lspImportStrategy';

import { resolveCompletionItem } from './lspCompletionResolve';
import type { RequestingPlugin } from './lspCompletionResolve';

/** 策略层触及的 CM6 补全项：导入策略形状 + `info`（渲染层/补丁注入的动态字段）。 */
type CompletableOption = StrategyCompletionOption & {
  info?: unknown;
};

/** 主题化 info 面板构建器（渲染层注入；docHtml = 服务器文档 HTML）。 */
export type CompletionInfoPanelBuilder = (docHtml: string) => HTMLElement;

/**
 * 按策略变换单个补全项，并包上「选中即 resolve → 主题化 info」的 info 函数
 * （行为与拆出前逐字一致）：
 *
 * - `applyImportStrategyToOption` 三态变换 apply（`auto` no-op / `never` 剥离
 *   附加编辑只留插入 / `ask` 包确认）—— 只包装 CM6 option.apply，不重算任何
 *   坐标与插入文本（D2 无旁路）；
 * - info 包装内读**实时**策略：`never` 下跳过选中解析（延迟编辑拿了也会被策略
 *   剥掉，不浪费请求；列表打开期间用户可能刚切了设置）。
 */
export function applyImportStrategyToCompletion(
  option: CompletableOption,
  strategy: LspImportStrategy,
  plugin: RequestingPlugin | null,
  buildInfoPanel: CompletionInfoPanelBuilder,
): void {
  applyImportStrategyToOption(option, strategy, { plugin });

  // Always attach a themed info panel - even without documentation,
  // the signature highlighting and structured returns add value.
  //
  // Note: `serverCompletionSource` does NOT copy `documentation` onto the
  // option object - it captures it inside the original `info` closure
  // (`() => renderDocInfo(plugin, item.documentation)`). So we resolve
  // docs by invoking the original renderer and reusing its HTML instead
  // of reading `option.documentation` (which is always undefined here).
  const originalInfo = typeof option.info === 'function' ? option.info : null;

  option.info = async function themedInfo() {
    // 选中即解析（CodeMirror 只为当前选中项调用 info）：取回被服务器
    // 推迟的 import 编辑，写回 `neekoDeferredEdits`，接受时与插入文本
    // 合并成同一事务。失败静默 —— 最多是这一项不带 import。
    if (plugin && getLspImportStrategy() !== 'never') {
      await resolveCompletionItem(option, plugin);
    }

    let docHtml = '';
    if (originalInfo) {
      const rendered = await originalInfo();
      if (rendered instanceof HTMLElement) docHtml = rendered.innerHTML;
    }
    return buildInfoPanel(docHtml);
  };
}

/**
 * 预热首个候选（CM6 打开列表时默认选中它）：把「选中→resolve→接受」的竞态
 * 窗口压到最小。`never` 下跳过（本就是为拿延迟编辑，拿了也丢）。
 */
export function prewarmCompletionStrategy(
  options: unknown[],
  strategy: LspImportStrategy,
  plugin: RequestingPlugin | null,
): void {
  if (plugin && options.length && strategy !== 'never') {
    void resolveCompletionItem(options[0] as object, plugin);
  }
}
