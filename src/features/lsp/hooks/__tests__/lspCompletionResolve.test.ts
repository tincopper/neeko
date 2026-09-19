// @vitest-environment node
/**
 * `completionItem/resolve` 往返（通用自动导包消费者）的行为契约。
 *
 * 客户端在 `initialize` 里向**所有**服务器声明了
 * `completionItem.resolveSupport.properties = ["additionalTextEdits"]`
 * （见 `src-tauri/src/lsp/session/instance.rs::build_client_capabilities`），
 * 部分服务器因此把 import 编辑从补全响应里撤走、改由 resolve 下发：
 *   - rust-analyzer 1.97.1：不声明 → flyimport 候选整条不发
 *   - jdtls 1.61.0：不声明 → 33 项全部内联；声明 → 改走 resolve
 *   - gopls v0.23.0：恒内联，不受影响
 * 声明即契约（红线 14）：这条链路必须真的存在，否则 Java/Rust 的自动导包会静默失效。
 */
import { describe, expect, it } from 'vitest';

import { resolveCompletionItem, type LspTextEdit } from '../lspCompletionResolve';

interface FakePlugin {
  client: { request: (method: string, params: unknown) => Promise<unknown> };
}

function pluginReturning(result: unknown): FakePlugin & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      request: async (method: string, params: unknown) => {
        calls.push({ method, params });
        return result;
      },
    },
  };
}

const USE_EDIT: LspTextEdit[] = [
  {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    newText: 'use std::collections::HashMap;\n',
  },
];

/** 服务器返回的"半成品"候选：没有 additionalTextEdits，只有 `data`。 */
function deferrableOption() {
  return {
    label: 'HashMap',
    neekoNeedsResolve: true,
    lspItem: {
      label: 'HashMap',
      data: { imports: [{ full_import_path: 'std::collections::HashMap' }] },
    },
  };
}

describe('completionItem/resolve 往返', () => {
  it('把原始 CompletionItem 原样回传（服务器靠 data 计算编辑）', async () => {
    const plugin = pluginReturning({ additionalTextEdits: USE_EDIT });
    const option = deferrableOption();

    await resolveCompletionItem(option, plugin);

    expect(plugin.calls).toHaveLength(1);
    const call = plugin.calls[0] as { method: string; params: unknown };
    expect(call.method).toBe('completionItem/resolve');
    // 必须带上 data —— 少了它 resolve 无从下手
    expect(call.params).toBe(option.lspItem);
    expect((call.params as { data: unknown }).data).toEqual(option.lspItem.data);
  });

  it('同一候选只解析一次（重复选中复用结果）', async () => {
    const plugin = pluginReturning({ additionalTextEdits: USE_EDIT });
    const option = deferrableOption();

    await Promise.all([
      resolveCompletionItem(option, plugin),
      resolveCompletionItem(option, plugin),
      resolveCompletionItem(option, plugin),
    ]);

    expect(plugin.calls).toHaveLength(1);
  });

  it('成功时把 import 编辑写回候选，供接受时同事务应用', async () => {
    const plugin = pluginReturning({ additionalTextEdits: USE_EDIT });
    const option = deferrableOption();

    const edits = await resolveCompletionItem(option, plugin);

    expect(edits).toEqual(USE_EDIT);
    expect(option.neekoDeferredEdits).toEqual(USE_EDIT);
  });

  it('服务器不带编辑（已内联）时写空数组，不覆盖既有事实', async () => {
    const plugin = pluginReturning({ label: 'HashMap' });
    const option = deferrableOption();

    const edits = await resolveCompletionItem(option, plugin);

    expect(edits).toEqual([]);
    expect(option.neekoDeferredEdits).toEqual([]);
  });

  it('resolve 失败时静默返回 null —— 绝不打断补全接受', async () => {
    const plugin: FakePlugin = {
      client: {
        request: async () => {
          throw new Error('LSP request timed out');
        },
      },
    };
    const option = deferrableOption();

    await expect(resolveCompletionItem(option, plugin)).resolves.toBeNull();
    expect(option.neekoDeferredEdits).toBeUndefined();
  });

  it('无候选 / 无插件 / 无可解析候选时不发请求', async () => {
    const plugin = pluginReturning({ additionalTextEdits: USE_EDIT });

    // ① 候选本身是 null（防御：调用点传了空值）
    await expect(resolveCompletionItem(null, plugin)).resolves.toBeNull();
    // ② 没有客户端句柄
    await expect(resolveCompletionItem(deferrableOption(), null)).resolves.toBeNull();
    // ② 服务器没给 data（无需 resolve）
    await expect(
      resolveCompletionItem({ label: 'x', lspItem: { label: 'x' } }, plugin),
    ).resolves.toBeNull();
    // ③ 库没透出原始 item（patch 丢失的极端情况）
    await expect(resolveCompletionItem({ label: 'x' }, plugin)).resolves.toBeNull();

    expect(plugin.calls).toHaveLength(0);
  });

  it('去重后再次选中不会重复发请求（结果已缓存）', async () => {
    const plugin = pluginReturning({ additionalTextEdits: USE_EDIT });
    const option = deferrableOption();

    await resolveCompletionItem(option, plugin);
    await resolveCompletionItem(option, plugin);
    const second = await resolveCompletionItem(option, plugin);

    expect(plugin.calls).toHaveLength(1);
    expect(second).toEqual(USE_EDIT);
  });
});
