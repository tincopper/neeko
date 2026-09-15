import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  languageHooks,
  registerLanguageHooks,
  resetLanguageHooksForTest,
  type LanguageHookBridge,
} from '../languageHooks';

/**
 * 语言钩子桥（**依赖反转**）的契约测试（Neeko Check F7）。
 *
 * 背景：通用 store 若要按 adapter type 取语言钩子，直接 import 语言清单会成环
 * （store → registry → 语言模块 → store，eslint `import/no-cycle`）。故改为「语言清单在加载时
 * 注入实现」，代价是把**编译期依赖**换成**运行期初始化顺序依赖**。本用例钉住这条代价的边界：
 * 未注入时必须可降级、注入后必须可用、出现第二个语言清单必须立即失败。
 */
const bridgeOf = (type = 'java'): LanguageHookBridge => ({
  adapterHookFor: (t: string) => (t === type ? ({ id: type } as never) : null),
  all: () => [],
});

describe('languageHooks 桥（依赖反转）', () => {
  beforeEach(() => {
    resetLanguageHooksForTest();
    vi.restoreAllMocks();
  });

  it('未注册 → null，且**只提示一次**（静默降级不允许无声无息）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(languageHooks()).toBeNull();
    expect(languageHooks()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('language hooks not registered');
  });

  it('注册后可按 adapter type 取到语言模块；未登记的 type → null', () => {
    registerLanguageHooks(bridgeOf('java'));
    expect(languageHooks()?.adapterHookFor('java')?.id).toBe('java');
    expect(languageHooks()?.adapterHookFor('custom-adapter')).toBeNull();
  });

  it('同一实现重复注册 → 幂等（语言清单可能被多次求值，不该因此报错）', () => {
    const bridge = bridgeOf();
    registerLanguageHooks(bridge);
    expect(() => registerLanguageHooks(bridge)).not.toThrow();
    expect(languageHooks()).toBe(bridge);
  });

  it('**不同**实现重复注册 → 立即失败（存在第二个语言清单即隐性错配）', () => {
    registerLanguageHooks(bridgeOf('java'));
    expect(() => registerLanguageHooks(bridgeOf('go'))).toThrow(/already registered/);
  });
});
