import { describe, expect, it, vi } from 'vitest';

import { resolveHoverLinkRoute } from '../lspHoverExtension';

const JDT_URI = 'jdt://contents/java.base/java.io/PrintStream.class?=q';

describe('resolveHoverLinkRoute — hover 链接点击路由（jdt → 宿主，其余 → 内置浏览器）', () => {
  it('jdt:// + 本视图有宿主回调 → 交给宿主（definition 管线只读展示）', () => {
    const open = vi.fn();

    const route = resolveHoverLinkRoute(JDT_URI, open);

    expect(route).toEqual({ kind: 'host', uri: JDT_URI, open });
  });

  it('jdt:// 但无宿主回调 → 回落内置浏览器（不得吞掉点击后无反应）', () => {
    expect(resolveHoverLinkRoute(JDT_URI)).toEqual({ kind: 'browser', href: JDT_URI });
    expect(resolveHoverLinkRoute(JDT_URI, undefined)).toEqual({
      kind: 'browser',
      href: JDT_URI,
    });
  });

  it('普通 http(s) 链接 → 内置浏览器（即使存在宿主回调）', () => {
    const https = 'https://docs.oracle.com/en/java/javase/21/docs/api/';

    expect(resolveHoverLinkRoute(https, vi.fn())).toEqual({ kind: 'browser', href: https });
  });
});
