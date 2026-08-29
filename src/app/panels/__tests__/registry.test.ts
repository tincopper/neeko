import { describe, expect, it } from 'vitest';

import { fixedPanelRegistry } from '../registry';

/** 真实注册表完整性：新增/修改 registry 项时的结构守卫（行为测试见 PanelHost.test.tsx）。 */
describe('fixedPanelRegistry', () => {
  it('id 唯一非空、placement 合法、Component 已定义', () => {
    const ids = fixedPanelRegistry.map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of fixedPanelRegistry) {
      expect(entry.id).toBeTruthy();
      expect(['left', 'right', 'bottom']).toContain(entry.placement);
      expect(entry.Component).toBeDefined();
    }
  });
});
