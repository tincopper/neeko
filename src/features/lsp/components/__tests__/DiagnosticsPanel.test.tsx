import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openInDefaultBrowser } from '@/features/browser/api/browserApi';

import { useLspStore } from '../../store/lspStore';
import type { LspDiagnostic } from '../../types';
import { DiagnosticsPanel } from '../DiagnosticsPanel';

vi.mock('@/features/browser/api/browserApi', () => ({
  openInDefaultBrowser: vi.fn(),
}));

const PROJECT = '/proj';

/** 构造一条最小诊断（LSP 行号 0-based）。 */
function diag(
  line: number,
  severity: number | null,
  message: string,
  source: string | null = 'test-ls',
): LspDiagnostic {
  return {
    range: { start: { line, character: 0 }, end: { line, character: 4 } },
    severity,
    message,
    source,
  };
}

/** 直接写诊断切片（D3 单写点：组件只读 store）。 */
function seed(byUri: Record<string, LspDiagnostic[]>) {
  useLspStore.setState({ diagnosticsByProject: { [PROJECT]: byUri } });
}

describe('DiagnosticsPanel', () => {
  beforeEach(() => {
    useLspStore.setState({ diagnosticsByProject: {}, problemsPanelOpen: false });
  });

  it('renders empty state when the project has no diagnostics', () => {
    render(<DiagnosticsPanel projectPath={PROJECT} />);
    expect(screen.getByText('No diagnostics')).toBeInTheDocument();
  });

  it('skips uris whose diagnostics array is empty (empty replace semantics)', () => {
    seed({
      'file:///proj/src/cleared.ts': [],
      'file:///proj/src/alive.ts': [diag(0, 1, 'still here')],
    });

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    expect(screen.getByText('still here')).toBeInTheDocument();
    expect(screen.queryByTestId('diagnostic-file-group-src/cleared.ts')).not.toBeInTheDocument();
  });

  it('orders errors before warnings inside a file group', () => {
    seed({
      'file:///proj/src/main.go': [diag(0, 2, 'the warning'), diag(5, 1, 'the error')],
    });

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    const rows = screen.getAllByTestId('diagnostic-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('the error');
    expect(rows[1]).toHaveTextContent('the warning');
  });

  // ── 文件组头（VS Code 视觉契约 1）───────────────────────────────────────

  it('renders group header with chevron, file icon, basename and dim parent dir', () => {
    seed({ 'file:///proj/cmd/agent/main_test.go': [diag(0, 1, 'undefined: fmt')] });

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    const header = screen.getByTestId('diagnostics-group-header-cmd/agent/main_test.go');
    // 文件名主文本色 + 父目录独立暗色段（名称在前、目录在后）
    expect(within(header).getByText('main_test.go')).toBeInTheDocument();
    expect(within(header).getByText('cmd/agent')).toBeInTheDocument();
    // 按扩展名的文件类型图标
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 结构关系断言（DOM 层级）必须用 querySelector
    expect(header.querySelector('img')).not.toBeNull();
    // 展开态 chevron 旋转 90°（∨ 形）
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 结构关系断言（DOM 层级）必须用 querySelector
    const chevron = header.querySelector('svg.lucide-chevron-right');
    expect(chevron).not.toBeNull();
    // eslint-disable-next-line testing-library/no-node-access -- class 结构断言
    expect(chevron?.classList.contains('rotate-90')).toBe(true);
  });

  it('renders root level file header without a parent dir segment', () => {
    seed({ 'file:///proj/main.go': [diag(0, 1, 'boom')] });

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    const header = screen.getByTestId('diagnostics-group-header-main.go');
    expect(within(header).getByText('main.go')).toBeInTheDocument();
    expect(within(header).getByTestId('diagnostic-group-count')).toHaveTextContent('1');
    // 根级文件：目录段（永远含 `/`）不存在
    expect(header).not.toHaveTextContent('/');
  });

  it('group count badge reflects the number of diagnostics in the group', () => {
    seed({
      'file:///proj/src/a.ts': [diag(0, 1, 'one'), diag(1, 2, 'two'), diag(2, 3, 'three')],
      'file:///proj/src/b.ts': [diag(0, 1, 'single')],
    });

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    expect(screen.getByTestId('diagnostics-group-header-src/a.ts')).toHaveTextContent('3');
    expect(screen.getByTestId('diagnostics-group-header-src/b.ts')).toHaveTextContent('1');
  });

  it('toggles group collapse on header click and hides rows while collapsed', () => {
    seed({ 'file:///proj/src/a.ts': [diag(0, 1, 'visible one'), diag(1, 2, 'visible two')] });

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    // 默认展开
    expect(screen.getAllByTestId('diagnostic-row')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('diagnostics-group-header-src/a.ts'));
    // 折叠：行不渲染，组头仍在
    expect(screen.queryByTestId('diagnostic-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('diagnostics-group-header-src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('a.ts')).toBeInTheDocument();

    // 再点一次恢复展开
    fireEvent.click(screen.getByTestId('diagnostics-group-header-src/a.ts'));
    expect(screen.getAllByTestId('diagnostic-row')).toHaveLength(2);
  });

  it('collapses only the clicked group, siblings stay expanded', () => {
    seed({
      'file:///proj/src/a.ts': [diag(0, 1, 'a diag')],
      'file:///proj/src/b.ts': [diag(0, 1, 'b diag')],
    });

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    fireEvent.click(screen.getByTestId('diagnostics-group-header-src/a.ts'));

    expect(screen.queryByText('a diag')).not.toBeInTheDocument();
    expect(screen.getByText('b diag')).toBeInTheDocument();
  });

  // ── 诊断行（VS Code 视觉契约 2）─────────────────────────────────────────

  it('maps severity to lucide icons: error warning info hint-and-null', () => {
    seed({
      'file:///proj/src/a.ts': [
        diag(0, 1, 'err msg'),
        diag(1, 2, 'warn msg'),
        diag(2, 3, 'info msg'),
        diag(3, 4, 'hint msg'),
        diag(4, null, 'null msg'),
      ],
    });

    const { container } = render(<DiagnosticsPanel projectPath={PROJECT} />);

    // error 红 ⊗ / warning 黄 ⚠ / info 蓝 / hint 暗（lucide 别名渲染为规范类名）
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 图标类名映射必须落到 svg class 查询
    expect(container.querySelectorAll('svg.lucide-circle-x')).toHaveLength(1);
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 图标类名映射必须落到 svg class 查询
    expect(container.querySelectorAll('svg.lucide-triangle-alert')).toHaveLength(1);
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 图标类名映射必须落到 svg class 查询
    expect(container.querySelectorAll('svg.lucide-info')).toHaveLength(1);
    // severity 4 与 null 都落到 hint 图标（CircleDot）
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 图标类名映射必须落到 svg class 查询
    expect(container.querySelectorAll('svg.lucide-circle-dot')).toHaveLength(2);
  });

  it('renders row segments: message, dim source, dark blue code and 1-based location', () => {
    seed({
      'file:///proj/cmd/agent/main_test.go': [
        {
          range: { start: { line: 55, character: 12 }, end: { line: 55, character: 15 } },
          severity: 1,
          message: 'undefined: fmt',
          source: 'compiler',
          code: 'UndeclaredName',
        },
      ],
    });

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    const row = screen.getByTestId('diagnostic-row');
    expect(within(row).getByText('undefined: fmt')).toBeInTheDocument();
    // source 暗色独立段
    expect(within(row).getByText('compiler')).toBeInTheDocument();
    // code 括号内独立段（暗蓝样式）
    const codeSeg = within(row).getByText('(UndeclaredName)');
    expect(codeSeg).toBeInTheDocument();
    expect(codeSeg).toHaveClass('text-blue-400/80');
    // LSP 0-based → 显示 +1：line 55 / character 12 → [Ln 56, Col 13]
    expect(within(row).getByText('[Ln 56, Col 13]')).toBeInTheDocument();
  });

  it('number code renders in parens too', () => {
    seed({
      'file:///proj/src/a.ts': [{ ...diag(0, 1, 'type err'), code: 2339 }],
    });

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    expect(screen.getByText('(2339)')).toBeInTheDocument();
  });

  it('omits the code segment when the diagnostic has no code', () => {
    seed({ 'file:///proj/src/a.ts': [diag(0, 1, 'no code here')] });

    const { container } = render(<DiagnosticsPanel projectPath={PROJECT} />);

    expect(screen.getByText('no code here')).toBeInTheDocument();
    // 无 code 不渲染括号段（凭空括号或空段都是回归）
    expect(container).not.toHaveTextContent('(');
  });

  it('invokes onJumpToDiagnostic with the uri and raw diagnostic on click', () => {
    const onJump = vi.fn();
    const target = diag(2, 1, 'undefined: Printf');
    seed({ 'file:///proj/src/main.go': [target] });

    render(<DiagnosticsPanel projectPath={PROJECT} onJumpToDiagnostic={onJump} />);
    fireEvent.click(screen.getByTestId('diagnostic-row'));

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith('file:///proj/src/main.go', target);
  });

  it('renders code as an external link when codeDescription.target exists', () => {
    seed({
      'file:///proj/cmd/agent/main_test.go': [
        {
          ...diag(55, 1, 'undefined: fmt'),
          code: 'UndeclaredName',
          codeDescription: { href: 'https://pkg.go.dev/go/types#UndeclaredName' },
        },
      ],
    });

    render(<DiagnosticsPanel projectPath={PROJECT} />);

    const link = screen.getByTestId('diagnostic-code-link');
    expect(link).toHaveAttribute('href', 'https://pkg.go.dev/go/types#UndeclaredName');
    expect(link).toHaveTextContent('(UndeclaredName)');
  });

  it('clicking the code link opens the docs instead of jumping the row', () => {
    const onJump = vi.fn();
    seed({
      'file:///proj/cmd/agent/main_test.go': [
        {
          ...diag(55, 1, 'undefined: fmt'),
          code: 'UndeclaredName',
          codeDescription: { href: 'https://pkg.go.dev/go/types#UndeclaredName' },
        },
      ],
    });

    render(<DiagnosticsPanel projectPath={PROJECT} onJumpToDiagnostic={onJump} />);
    fireEvent.click(screen.getByTestId('diagnostic-code-link'));

    expect(openInDefaultBrowser).toHaveBeenCalledTimes(1);
    expect(openInDefaultBrowser).toHaveBeenCalledWith('https://pkg.go.dev/go/types#UndeclaredName');
    // stopPropagation：点链接不得同时触发行级跳转（双动作）
    expect(onJump).not.toHaveBeenCalled();
  });
});
