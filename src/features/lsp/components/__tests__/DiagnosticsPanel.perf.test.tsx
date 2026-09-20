// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLspStore } from '../../store/lspStore';
import type { LspDiagnostic } from '../../types';
import { DiagnosticsPanel } from '../DiagnosticsPanel';
import { SeverityIcon } from '../SeverityIcon';

// P3 行 memo 验证：mock SeverityIcon 为计数组件，行重渲染必然重新调用它。
// 本文件聚焦性能回归，不关心图标渲染细节；既有视觉断言在 DiagnosticsPanel.test.tsx。
vi.mock('../SeverityIcon', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../SeverityIcon')>();
  return {
    ...actual,
    SeverityIcon: vi.fn(() => null),
  };
});

const PROJECT = '/proj';

function diag(line: number, message = 'boom'): LspDiagnostic {
  return {
    range: { start: { line, character: 0 }, end: { line, character: 4 } },
    severity: 1,
    message,
    source: 'test-ls',
  };
}

function seed(byUri: Record<string, LspDiagnostic[]>) {
  useLspStore.setState({ diagnosticsByProject: { [PROJECT]: byUri } });
}

describe('DiagnosticsPanel performance (P2/P3)', () => {
  beforeEach(() => {
    useLspStore.setState({ diagnosticsByProject: {}, problemsPanelOpen: false });
    vi.mocked(SeverityIcon).mockClear();
  });

  it('default-collapses groups when group count exceeds threshold (zero rows)', () => {
    const byUri: Record<string, LspDiagnostic[]> = {};
    for (let i = 0; i < 30; i += 1) {
      byUri[`file:///proj/src/file${i}.java`] = [diag(i, `diag-${i}`)];
    }
    seed(byUri);

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    // 30 组 > 阈值 20 → 默认全折叠：组头在、行零
    expect(screen.getAllByTestId('diagnostic-file-group-src/file0.java')).toHaveLength(1);
    expect(screen.queryAllByTestId('diagnostic-row')).toHaveLength(0);

    // 点击某组头 → 该组展开，行出现
    fireEvent.click(screen.getByTestId('diagnostics-group-header-src/file0.java'));
    expect(screen.getAllByTestId('diagnostic-row')).toHaveLength(1);
    expect(screen.getByText('diag-0')).toBeInTheDocument();
  });

  it('keeps default-expanded when group count is at or below threshold', () => {
    const byUri: Record<string, LspDiagnostic[]> = {};
    for (let i = 0; i < 20; i += 1) {
      byUri[`file:///proj/src/file${i}.go`] = [diag(i, `diag-${i}`)];
    }
    seed(byUri);

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    // 20 组 = 阈值 → 仍默认展开（小项目零行为变化）
    expect(screen.getAllByTestId('diagnostic-row')).toHaveLength(20);
  });

  it('does not re-render existing rows on unrelated-uri publish (memo)', () => {
    // 保持 a/b 诊断**对象引用不变**（模拟 P1 合并后仅 c 键更新）：
    // 引用若被重建，memo 浅比较自然失效，测试就测的不是"无关 publish"了。
    const aDiags = [diag(0, 'in a')];
    const bDiags = [diag(0, 'in b')];
    seed({
      'file:///proj/src/a.java': aDiags,
      'file:///proj/src/b.java': bDiags,
    });
    render(<DiagnosticsPanel projectPath={PROJECT} />);

    // 两行展开渲染 → 各自一次 SeverityIcon
    expect(screen.getAllByTestId('diagnostic-row')).toHaveLength(2);
    expect(vi.mocked(SeverityIcon).mock.calls.length).toBe(2);

    // 无关 uri（c.java）publish：a/b 行 props（诊断引用/uri/languageId/onJump）全不变，
    // memo 跳过 → SeverityIcon 只 +1（=3），而非 2→4
    act(() => {
      useLspStore.setState({
        diagnosticsByProject: {
          [PROJECT]: {
            'file:///proj/src/a.java': aDiags,
            'file:///proj/src/b.java': bDiags,
            'file:///proj/src/c.java': [diag(0, 'in c')],
          },
        },
      });
    });

    expect(vi.mocked(SeverityIcon).mock.calls.length).toBe(3);
    expect(screen.getByText('in c')).toBeInTheDocument();
    // 无关 publish 后仍为 3 行（新增 c 组一行，a/b 行未重建）
    expect(screen.getAllByTestId('diagnostic-row')).toHaveLength(3);
  });
});
