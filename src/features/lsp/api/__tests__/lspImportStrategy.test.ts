// @vitest-environment node
/**
 * M4 导入策略三态（R4/AC4）：`auto` 放行 / `never` 剥离附加编辑只插标识符 /
 * `ask` 带 import 预览确认。
 *
 * 约束（design.md D2 + 任务约束）：
 * - 策略层**只抑制**附加编辑，绝不自己计算 import 位置；
 * - 不改 `@codemirror/lsp-client` 包（补丁层不动），只包装 CM6 option.apply；
 * - CM6 option 上没有 `additionalTextEdits` 字段（库构建期已装成 apply 闭包），
 *   因此"有没有附加编辑"只能从补丁透出的 `lspItem`（内联）+
 *   `neekoNeedsResolve` / `neekoDeferredEdits`（延迟）判定；
 * - "只插标识符"用 dispatch-shim 实现：原 apply 只碰 `{state, dispatch}`
 *   （补丁注释已证）， insider 两个分支都以"首个 spec = 插入、其余 = 附加编辑"
 *   的形状 dispatch —— 转发首个 spec 即保留插入、丢掉 import，且与库的插入行为
 *   （snippet 占位、光标落点）逐字一致。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyImportStrategyToOption,
  getLspImportStrategy,
  optionCarriesImportEdits,
  parseImportStrategy,
  setLspImportStrategy,
  summarizeAdditionalEdits,
  type LspImportStrategyConfirm,
  type StrategyCompletionOption,
} from '../lspImportStrategy';

afterEach(() => {
  setLspImportStrategy('auto');
});

/** dispatch 调用记录器：只实现补丁 apply 用到的 state + dispatch。 */
function makeView() {
  const calls: unknown[][] = [];
  const view = {
    state: { doc: 'fake-doc-marker' },
    dispatch: (...specs: unknown[]) => {
      calls.push(specs);
    },
  };
  return { view, calls };
}

const IMPORT_RANGE = {
  range: { start: { line: 2, character: 8 }, end: { line: 2, character: 8 } },
};

/** gopls 形态：内联 additionalTextEdits（import "fmt"）。 */
function goLikeOption(applyImpl?: (view: unknown, c: unknown, from: number, to: number) => void) {
  return {
    label: 'Println',
    lspItem: {
      label: 'Println',
      additionalTextEdits: [{ ...IMPORT_RANGE, newText: '\n\t"fmt"' }],
    },
    apply:
      applyImpl ??
      ((view: unknown) => {
        // 与补丁的非 snippet 分支同形状：首个 spec = 插入，其余 = 附加编辑。
        (view as { dispatch: (...s: unknown[]) => void }).dispatch(
          { insert: 'Println' },
          { changes: [{ from: 10, to: 10, insert: '\n\t"fmt"' }] },
        );
      }),
  } as unknown as StrategyCompletionOption;
}

/** rust-analyzer 形态：编辑推迟到 resolve（只有 data）。 */
function rustLikeOption() {
  return {
    label: 'HashMap',
    lspItem: { label: 'HashMap', data: { imports: [] } },
    neekoNeedsResolve: true,
    apply: (view: unknown) => {
      // 与补丁的 snippet 分支同形状（r-a flyimport 走 resolve + snippet 插入）。
      (view as { dispatch: (...s: unknown[]) => void }).dispatch(
        { snippetTxn: true },
        { changes: [{ from: 0, to: 0, insert: 'use std::collections::HashMap;\n' }] },
      );
    },
  } as unknown as StrategyCompletionOption;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('parseImportStrategy', () => {
  it('合法三态原样通过', () => {
    expect(parseImportStrategy('auto')).toBe('auto');
    expect(parseImportStrategy('ask')).toBe('ask');
    expect(parseImportStrategy('never')).toBe('never');
  });

  it('缺字段 / 非法值回落 auto（#[serde(default)] 语义的 TS 侧）', () => {
    expect(parseImportStrategy(undefined)).toBe('auto');
    expect(parseImportStrategy(null)).toBe('auto');
    expect(parseImportStrategy('')).toBe('auto');
    expect(parseImportStrategy('AUTO')).toBe('auto');
    expect(parseImportStrategy('sometimes')).toBe('auto');
    expect(parseImportStrategy(42)).toBe('auto');
    expect(parseImportStrategy({})).toBe('auto');
  });
});

describe('策略读取点（模块级同步缓存）', () => {
  it('默认 auto（同步遗漏时 fail-open 到现状行为）', () => {
    expect(getLspImportStrategy()).toBe('auto');
  });

  it('set/get roundtrip', () => {
    setLspImportStrategy('ask');
    expect(getLspImportStrategy()).toBe('ask');
    setLspImportStrategy('never');
    expect(getLspImportStrategy()).toBe('never');
  });
});

describe('optionCarriesImportEdits', () => {
  it('内联 additionalTextEdits 非空 → true', () => {
    expect(optionCarriesImportEdits(goLikeOption())).toBe(true);
  });

  it('无 lspItem 的裸候选 → false', () => {
    expect(optionCarriesImportEdits({ label: 'foo' })).toBe(false);
  });

  it('空附加编辑且无延迟标记 → false', () => {
    expect(
      optionCarriesImportEdits({
        label: 'foo',
        lspItem: { label: 'foo', additionalTextEdits: [] },
      }),
    ).toBe(false);
  });

  it('neekoNeedsResolve（延迟编辑未知）→ true（按"有"处理，不静默吞 import 意图）', () => {
    expect(optionCarriesImportEdits(rustLikeOption())).toBe(true);
  });

  it('仅 neekoDeferredEdits 非空 → true', () => {
    expect(
      optionCarriesImportEdits({
        label: 'HashMap',
        lspItem: { label: 'HashMap' },
        neekoDeferredEdits: [{ ...IMPORT_RANGE, newText: 'use x;\n' }],
      }),
    ).toBe(true);
  });
});

describe('summarizeAdditionalEdits', () => {
  it('取每条 newText 的首个非空行', () => {
    expect(
      summarizeAdditionalEdits([
        { ...IMPORT_RANGE, newText: '\n\t"fmt"' },
        { ...IMPORT_RANGE, newText: 'use std::collections::HashMap;\n' },
      ]),
    ).toEqual(['"fmt"', 'use std::collections::HashMap;']);
  });

  it('空编辑 → 空摘要（ask 直接放行不打扰）', () => {
    expect(summarizeAdditionalEdits([])).toEqual([]);
    expect(summarizeAdditionalEdits([{ ...IMPORT_RANGE, newText: '\n  \n' }])).toEqual([]);
  });

  it('摘要有上界（多条只取前 5）', () => {
    const edits = Array.from({ length: 9 }, (_, i) => ({
      ...IMPORT_RANGE,
      newText: `import-${i};\n`,
    }));
    expect(summarizeAdditionalEdits(edits)).toHaveLength(5);
  });
});

describe('auto 策略', () => {
  it('不碰 apply（与现状逐字一致）', () => {
    const option = goLikeOption();
    const before = option.apply;
    applyImportStrategyToOption(option, 'auto');
    expect(option.apply).toBe(before);
  });
});

describe('never 策略', () => {
  it('无附加编辑的候选：apply 原样保留', () => {
    const option = { label: 'foo' } as StrategyCompletionOption;
    applyImportStrategyToOption(option, 'never');
    expect(option.apply).toBeUndefined();
  });

  it('内联编辑：接受补全只做一次 dispatch，且只含插入 spec（import 被剥离）', () => {
    const option = goLikeOption();
    applyImportStrategyToOption(option, 'never');
    expect(typeof option.apply).toBe('function');

    const { view, calls } = makeView();
    (option.apply as (v: unknown, c: unknown, f: number, t: number) => void)(view, {}, 1, 4);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    expect(calls[0][0]).toEqual({ insert: 'Println' });
  });

  it('延迟项（neekoNeedsResolve）：同样剥离，只保留 snippet 插入事务', () => {
    const option = rustLikeOption();
    applyImportStrategyToOption(option, 'never');

    const { view, calls } = makeView();
    (option.apply as (v: unknown, c: unknown, f: number, t: number) => void)(view, {}, 0, 4);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([{ snippetTxn: true }]);
  });

  it('字符串 apply（库自带纯插入分支，无编辑可剥）保持原样', () => {
    const option = { label: 'x', apply: 'insertText' } as unknown as StrategyCompletionOption;
    applyImportStrategyToOption(option, 'never');
    expect(option.apply).toBe('insertText');
  });

  it('不弹任何确认', async () => {
    const confirm: LspImportStrategyConfirm = vi.fn(async () => true);
    const option = goLikeOption();
    applyImportStrategyToOption(option, 'never', { confirm });
    const { view } = makeView();
    (option.apply as (v: unknown, c: unknown, f: number, t: number) => void)(view, {}, 1, 4);
    await flush();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('ask 策略', () => {
  it('无附加编辑：apply 原样保留且不打扰（不弹确认）', async () => {
    const confirm: LspImportStrategyConfirm = vi.fn(async () => true);
    const option = { label: 'foo' } as StrategyCompletionOption;
    applyImportStrategyToOption(option, 'ask', { confirm });
    expect(option.apply).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('确认放行：原 apply 被完整调用（插入 + import 双 spec）', async () => {
    const confirm: LspImportStrategyConfirm = vi.fn(async () => true);
    const option = goLikeOption();
    applyImportStrategyToOption(option, 'ask', { confirm });

    const { view, calls } = makeView();
    (option.apply as (v: unknown, c: unknown, f: number, t: number) => void)(view, {}, 1, 4);
    await flush();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(calls[0][0]).toEqual({ insert: 'Println' });
  });

  it('取消：只插入标识符（与 never 同形：单 spec），确认文案含 import 摘要', async () => {
    const confirm: LspImportStrategyConfirm = vi.fn(async () => false);
    const option = goLikeOption();
    applyImportStrategyToOption(option, 'ask', { confirm });

    const { view, calls } = makeView();
    (option.apply as (v: unknown, c: unknown, f: number, t: number) => void)(view, {}, 1, 4);
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([{ insert: 'Println' }]);
    const req = vi.mocked(confirm).mock.calls[0][0];
    expect(req.message).toContain('"fmt"');
  });

  it('延迟项尚未 resolve：先补一次 resolve 再确认（预览来自取回的编辑）', async () => {
    const deferred = [{ ...IMPORT_RANGE, newText: 'use std::collections::HashMap;\n' }];
    const resolve = vi.fn(async (opt: object) => {
      (opt as { neekoDeferredEdits?: unknown }).neekoDeferredEdits = deferred;
      return deferred;
    });
    const confirm: LspImportStrategyConfirm = vi.fn(async () => true);
    const plugin = { client: { request: vi.fn() } };
    const option = rustLikeOption();
    applyImportStrategyToOption(option, 'ask', { confirm, resolve, plugin });

    const { view, calls } = makeView();
    (option.apply as (v: unknown, c: unknown, f: number, t: number) => void)(view, {}, 0, 4);
    await flush();
    await flush();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][0]).toBe(option);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirm).mock.calls[0][0].message).toContain('use std::collections::HashMap;');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
  });

  it('resolve 后仍无编辑：直接放行原 apply，不弹确认', async () => {
    const resolve = vi.fn(async () => []);
    const confirm: LspImportStrategyConfirm = vi.fn(async () => true);
    // neekoNeedsResolve 为真但 resolve 取回空 → 视为无编辑。
    const option = {
      label: 'HashMap',
      lspItem: { label: 'HashMap', data: {} },
      neekoNeedsResolve: true,
      apply: (view: unknown) => {
        (view as { dispatch: (...s: unknown[]) => void }).dispatch({ insert: 'HashMap' });
      },
    } as unknown as StrategyCompletionOption;
    applyImportStrategyToOption(option, 'ask', { confirm, resolve, plugin: null });

    const { view, calls } = makeView();
    (option.apply as (v: unknown, c: unknown, f: number, t: number) => void)(view, {}, 0, 4);
    await flush();
    await flush();

    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('from/to/completion 原样透传给原 apply', async () => {
    const seen: unknown[] = [];
    const confirm: LspImportStrategyConfirm = vi.fn(async () => true);
    const completion = { label: 'Println' };
    const option = goLikeOption((view, c, from, to) => {
      seen.push([view, c, from, to]);
      (view as { dispatch: (...s: unknown[]) => void }).dispatch({ insert: 'x' });
    });
    applyImportStrategyToOption(option, 'ask', { confirm });

    const { view } = makeView();
    (option.apply as (v: unknown, c: unknown, f: number, t: number) => void)(
      view,
      completion,
      7,
      9,
    );
    await flush();

    expect(seen[0]).toEqual([view, completion, 7, 9]);
  });
});
