/**
 * M4 导入策略三态（R4/AC4）：`auto` 放行 / `never` 剥离附加编辑 / `ask` 确认后放行。
 *
 * 作用点 = 补全接受前拦截（design.md M4）：本模块只包装 CM6 option.apply，
 * 是所有补全项的必经之路（`createThemedCompletionSource` 返回处调用），D2 无旁路。
 *
 * 关键约束——CM6 option 上**没有** `additionalTextEdits` 字段：库在构建期就把
 * 附加编辑装成了 `apply` 闭包。因此：
 * - "有没有附加编辑"只能从补丁透出的信号判定：`lspItem.additionalTextEdits`
 *   （内联）+ `neekoNeedsResolve` / `neekoDeferredEdits`（延迟到 resolve 的）；
 * - "剥离附加编辑"不能靠删除字段，只能换掉 `apply`。换法是 dispatch-shim：
 *   库的两个 apply 分支（补丁 `dist/index.js` 的 snippet 合并分支与
 *   `applyEdits`）都只碰 `{state, dispatch}`，且都以"首个 spec = 插入、
 *   其余 spec = 附加编辑"的形状做**一次** dispatch —— 转发首个 spec 即保留
 *   插入（含 snippet 占位与光标落点，逐字与库一致）、丢掉 import。
 *   我们**不重算任何坐标、不重组任何插入文本**（D2：不许自己算 import 位置，
 *   这里连插入文本都不碰）。
 * - `never` 因此顺带跳过 resolve 预热（调用方负责：预热本就是为拿延迟编辑，
 *   never 下拿了也丢）；`ask` 保留预热（预览要靠它）。
 *
 * 语言无关性（R5）：全程只认 LSP 通用字段（additionalTextEdits / data），
 * 零语言分支。
 */
import type { ConfirmRequest } from '@/shared/store/confirmStore';
import { confirmAction } from '@/shared/store/confirmStore';
import type { LspImportStrategy } from '@/shared/types/settings';

export type { LspImportStrategy };

import {
  resolveCompletionItem,
  type LspTextEdit,
  type RequestingPlugin,
} from '../hooks/lspCompletionResolve';

/** 补全接受时是否自动应用附加编辑（自动导入）的策略类型见 `@/shared/types/settings`。 */

/**
 * 设置边界解析：未知 / 缺字段一律回落 `auto`
 *（`#[serde(default)]` 语义的 TS 侧；`useAppConfig.mergeLspConfig` 经此接入）。
 */
export function parseImportStrategy(v: unknown): LspImportStrategy {
  if (v === 'auto' || v === 'ask' || v === 'never') return v;
  return 'auto';
}

/**
 * 当前策略的模块级同步缓存（`languageMap.customExtMap` 同款模式）。
 *
 * 补全源跑在 CM6 回调里（无 React 上下文），只能同步读取。写入方唯一：
 * `useAppConfig`（启动加载 + 保存时同步，单写点）。默认 `auto` = 同步遗漏时
 * fail-open 到现状行为。
 */
let currentStrategy: LspImportStrategy = 'auto';

export function getLspImportStrategy(): LspImportStrategy {
  return currentStrategy;
}

export function setLspImportStrategy(strategy: LspImportStrategy): void {
  currentStrategy = strategy;
}

/**
 * 策略层关心的 CM6 option 最小形状。库本身不声明这些字段（由
 * `patches/@codemirror__lsp-client@6.2.5.patch` 透出 `lspItem` /
 * `neekoNeedsResolve`，由 `lspCompletionResolve` 写回 `neekoDeferredEdits`）。
 */
export interface StrategyCompletionOption {
  label?: unknown;
  apply?: unknown;
  /** 原始 LSP CompletionItem（含内联 additionalTextEdits 与 resolve 凭据 data）。 */
  lspItem?: {
    additionalTextEdits?: LspTextEdit[] | null;
    data?: unknown;
  } | null;
  /** 服务器给了 data = 编辑在 resolve 里（构建期判定，见补丁注释）。 */
  neekoNeedsResolve?: boolean;
  /** resolve 取回的延迟编辑（接受时由补丁并入同一事务）。 */
  neekoDeferredEdits?: LspTextEdit[];
}

function inlineEdits(option: StrategyCompletionOption): LspTextEdit[] {
  const raw = option.lspItem?.additionalTextEdits;
  return Array.isArray(raw) ? raw : [];
}

/** 该项是否携带 import 编辑（内联或延迟；延迟未知按"有"处理，不静默吞意图）。 */
export function optionCarriesImportEdits(
  option: StrategyCompletionOption | null | undefined,
): boolean {
  if (!option) return false;
  if (inlineEdits(option).length > 0) return true;
  if (option.neekoNeedsResolve) return true;
  const deferred = option.neekoDeferredEdits;
  return Array.isArray(deferred) && deferred.length > 0;
}

/** 内联 + 已取回的延迟编辑（LSP 形状，服务器坐标；仅用于预览文案，不参与计算）。 */
export function collectStrategyEdits(option: StrategyCompletionOption): LspTextEdit[] {
  const all = inlineEdits(option).slice();
  if (Array.isArray(option.neekoDeferredEdits)) all.push(...option.neekoDeferredEdits);
  return all;
}

/** 确认框预览的上界：再多用户也读不完，截断保可读。 */
const MAX_SUMMARY_LINES = 5;

/** 每条 newText 取首个非空行（如 `import "fmt"` / `use std::…;`）。 */
export function summarizeAdditionalEdits(edits: LspTextEdit[] | null | undefined): string[] {
  if (!Array.isArray(edits)) return [];
  const out: string[] = [];
  for (const edit of edits) {
    if (out.length >= MAX_SUMMARY_LINES) break;
    const text = typeof edit?.newText === 'string' ? edit.newText : '';
    const first = text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (first) out.push(first);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CompletionApplyFn = (view: any, completion: any, from: number, to: number) => void;

/**
 * 只做插入、丢掉附加编辑：把原 apply 的 dispatch 收敛到首个 spec。
 *
 * 前提（补丁现状，改补丁须同步复核此处）：原 apply 每次接受恰好 dispatch 一次，
 * 且首个 spec 即插入。转发首个 spec 后插入行为与库逐字一致。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyInsertOnly(
  original: CompletionApplyFn,
  view: any,
  completion: any,
  from: number,
  to: number,
): void {
  const shim = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get state(): any {
      return view.state;
    },
    dispatch: (...specs: unknown[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (view.dispatch as (...s: unknown[]) => void)(specs[0]);
    },
  };
  original(shim, completion, from, to);
}

export type LspImportStrategyConfirm = (req: ConfirmRequest) => Promise<boolean>;

export interface ImportStrategyDeps {
  /** resolve 走的客户端句柄（ask 补解析用；never 不需要）。 */
  plugin?: RequestingPlugin | null;
  /** 可注入（单测桩）；默认真实 `completionItem/resolve`（WeakMap 去重、失败静默）。 */
  resolve?: (option: object, plugin: RequestingPlugin | null | undefined) => Promise<unknown>;
  /** 可注入（单测桩）；默认应用级确认框（无宿主时 fail-closed 返回 false）。 */
  confirm?: LspImportStrategyConfirm;
}

/**
 * 按策略变换单个补全项（原地改写 `option.apply`，与渲染层既有循环风格一致）。
 *
 * - `auto`（及一切未知值）：no-op；
 * - `never`：携带编辑的项换成只插入；无编辑 / 字符串 apply（库自带纯插入，
 *   无编辑可剥）原样保留；
 * - `ask`：携带编辑的项包确认（预览 = 摘要）；无编辑直接放行不打扰。
 */
export function applyImportStrategyToOption(
  option: StrategyCompletionOption | null | undefined,
  strategy: LspImportStrategy,
  deps: ImportStrategyDeps = {},
): void {
  if (!option) return;
  if (strategy !== 'ask' && strategy !== 'never') return;
  if (typeof option.apply !== 'function') return;
  if (!optionCarriesImportEdits(option)) return;

  const original = option.apply as CompletionApplyFn;

  if (strategy === 'never') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    option.apply = (view: any, completion: any, from: number, to: number) =>
      applyInsertOnly(original, view, completion, from, to);
    return;
  }

  // ask：接受时（用户意图已明确）再问，预览靠内联 + 已 resolve 的延迟编辑。
  const confirm = deps.confirm ?? confirmAction;
  const resolve = deps.resolve ?? resolveCompletionItem;
  const plugin = deps.plugin ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  option.apply = (view: any, completion: any, from: number, to: number) => {
    void (async () => {
      try {
        // 选中即解析通常已取回；用户快过 resolve 时这里补一次（去重，无额外请求）。
        if (option.neekoNeedsResolve && option.neekoDeferredEdits == null && plugin) {
          await resolve(option, plugin);
        }
      } catch {
        // resolve 永不抛（失败静默）；自定义 deps 若抛，按无编辑放行（声明前行为）。
      }
      const edits = collectStrategyEdits(option);
      if (edits.length === 0) {
        original(view, completion, from, to);
        return;
      }
      const lines = summarizeAdditionalEdits(edits);
      let ok = false;
      try {
        ok = await confirm({
          title: 'Apply auto-import edits?',
          message: `This completion wants to add these imports:\n${lines.map((line) => `  ${line}`).join('\n')}\nApply them together with the completion?`,
          confirmLabel: 'Apply imports',
        });
      } catch {
        // 确认通道故障 → fail-open 到 auto 行为（不丢用户已选的补全）。
        original(view, completion, from, to);
        return;
      }
      if (ok) {
        original(view, completion, from, to);
      } else {
        // 取消 = 只插入标识符（与 never 同形，单事务内单 spec）。
        applyInsertOnly(original, view, completion, from, to);
      }
    })();
  };
}
