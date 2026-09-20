import { describe, expect, it } from 'vitest';

import { severityColorClass, severityName, severitySvgMarkup } from '../SeverityIcon';

describe('diagnosticSeverity（Problems 行与 hover popup 共用的 lucide 图标来源）', () => {
  it('LSP severity 数值归一到语义名：1 error / 2 warning / 3 info / 其余 hint', () => {
    expect(severityName(1)).toBe('error');
    expect(severityName(2)).toBe('warning');
    expect(severityName(3)).toBe('info');
    expect(severityName(4)).toBe('hint');
    expect(severityName(null)).toBe('hint');
  });

  it('配色类与语义名对应：红 / 黄 / 蓝 / 暗', () => {
    expect(severityColorClass(1)).toBe('text-red-500');
    expect(severityColorClass(2)).toBe('text-yellow-500');
    expect(severityColorClass(3)).toBe('text-blue-500');
    expect(severityColorClass(null)).toBe('text-text-muted');
  });

  it('原生 SVG 标记用 lucide 类名（面板与 popup 同一份图标，非手写 path）', () => {
    expect(severitySvgMarkup(1, 14)).toContain('lucide-circle-x');
    expect(severitySvgMarkup(2)).toContain('lucide-triangle-alert');
    expect(severitySvgMarkup(3)).toContain('lucide-info');
    expect(severitySvgMarkup(null)).toContain('lucide-circle-dot');
    // 不同 severity 形状不同
    expect(severitySvgMarkup(2)).not.toBe(severitySvgMarkup(1));
  });
});
