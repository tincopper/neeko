/**
 * `completionItem/resolve` 的客户端侧消费者 —— **通用，不区分语言**。
 *
 * 为什么需要它：客户端在 `initialize` 里向所有服务器声明了
 * `completionItem.resolveSupport.properties = ["additionalTextEdits"]`
 * （`src-tauri/src/lsp/session/instance.rs::build_client_capabilities`）。
 * 声明即契约（红线 14）：声明了"我能延迟取回 import 编辑"，就必须真的发得出去。
 * 各服务器的反应不同，但都由这一条链路兜住（实测 2026-09-19）：
 *   - rust-analyzer 1.97.1：不声明 → flyimport 候选**整条不发**；声明 → 编辑走 resolve
 *   - jdtls 1.61.0：不声明 → import 编辑内联返回；声明 → 同样改走 resolve
 *   - gopls v0.23.0：恒内联，声明与否都不变
 *
 * 取回的编辑写入候选项的 `neekoDeferredEdits`，由 pnpm patch 后的
 * `apply`/`applyEdits` 在**接受时**与插入文本合并成**一个事务**
 * （单步撤销、无坐标漂移），而不是补第二次 dispatch。
 */

/** LSP 侧的 `TextEdit`（区别于 CM6 的 `{from, to, insert}`）。 */
export interface LspTextEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

/**
 * CM6 completion option 上与本模块相关的字段。库本身不声明它们，由
 * `patches/@codemirror__lsp-client@6.2.5.patch` 透出 `lspItem` 后由
 * `lspCompletionInfoRenderer` 标注 `neekoNeedsResolve`。
 */
export interface ResolvableCompletionOption {
  /** 原始 LSP CompletionItem —— resolve 必须原样回传（服务器靠其 `data` 计算）。 */
  lspItem?: unknown;
  /**
   * 该项是否需要 resolve：服务器给了 `data` 才为真。
   * 之所以必须提前标注：库在**构建期**就决定给不给该项装 `apply`，
   * 而延迟项 `insertText === label` 会让它的所有分支都不命中。
   */
  neekoNeedsResolve?: boolean;
  /** resolve 取回的 import 编辑；由本模块写入，接受时被消费。 */
  neekoDeferredEdits?: LspTextEdit[];
}

/**
 * 调用方只需满足这个最小契约（能发一条 LSP 请求）。
 *
 * 刻意**不** import `LSPPlugin`：本模块不应知道补全来自哪个库/哪个编辑器——
 * `LSPPlugin.client.request` 结构上满足此接口，duck typing 即可传进来。
 * 好处：依赖方向单向（本模块 → 无外部依赖），测试只需一个 `{client:{request}}` 桩。
 */
export interface RequestingPlugin {
  client: {
    request: (method: string, params: unknown) => Promise<unknown>;
  };
}

/** 按候选项去重：同一项重复选中只发一次请求（WeakMap 随结果一起回收）。 */
const inflight = new WeakMap<object, Promise<LspTextEdit[] | null>>();

/**
 * 取回某个候选项被服务器推迟的附加编辑（自动导入的 `use …;` / `import …;`）。
 *
 * 幂等且**永不抛错**：resolve 失败只是拿不到编辑，补全本身照旧可用
 * （退化为"插入标识符但不带 import"，即声明之前的行为）。
 *
 * @returns 取到的编辑列表（可能为空数组），无需/无法解析时为 `null`。
 */
export async function resolveCompletionItem(
  option: object | null | undefined,
  plugin: RequestingPlugin | null | undefined,
): Promise<LspTextEdit[] | null> {
  if (!option || !plugin) return null;
  const resolvable = option as ResolvableCompletionOption;
  // 只有服务器给了 `data` 的项需要解析：`data` 正是"回传给 resolve 的凭据"。
  if (!resolvable.neekoNeedsResolve || !resolvable.lspItem) return null;

  const cached = inflight.get(option);
  if (cached) return cached;

  const pending = (async (): Promise<LspTextEdit[] | null> => {
    try {
      // 原样回传原始 item：r-a / jdtls 都靠其中的 `data` 定位导入项。
      const resolved = (await plugin.client.request(
        'completionItem/resolve',
        resolvable.lspItem,
      )) as {
        additionalTextEdits?: LspTextEdit[] | null;
      } | null;
      const edits = resolved?.additionalTextEdits ?? [];
      resolvable.neekoDeferredEdits = edits;
      return edits;
    } catch {
      // 超时 / 服务器不支持 resolve：静默放弃，不阻塞补全。
      return null;
    }
  })();

  inflight.set(option, pending);
  return pending;
}
