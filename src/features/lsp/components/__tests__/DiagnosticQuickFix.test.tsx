import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LspDiagnostic } from '../../types';
import { DiagnosticQuickFix } from '../DiagnosticQuickFix';

vi.mock('../../api/codeAction', async () => ({
  ...(await vi.importActual<typeof import('../../api/codeAction')>('../../api/codeAction')),
  requestCodeActions: vi.fn(),
  applyCodeAction: vi.fn(),
  runAiQuickFixAction: vi.fn(() => true),
}));

const { requestCodeActions, applyCodeAction, runAiQuickFixAction } =
  await import('../../api/codeAction');

const DIAG: LspDiagnostic = {
  range: { start: { line: 3, character: 1 }, end: { line: 3, character: 5 } },
  severity: 1,
  message: 'undefined: fmt',
  source: 'gopls',
};

const ACTIONS = [
  { title: 'Add import: "fmt"', kind: 'quickfix', edit: { changes: {} } },
  { title: 'Organize Imports', kind: 'source.organizeImports', edit: { changes: {} } },
  { title: 'Browse assembly', command: { command: 'gopls.assembly' } },
];

describe('DiagnosticQuickFix', () => {
  beforeEach(() => {
    vi.mocked(requestCodeActions).mockReset();
    vi.mocked(applyCodeAction).mockReset();
    vi.mocked(requestCodeActions).mockResolvedValue(ACTIONS);
    vi.mocked(applyCodeAction).mockReturnValue(true);
  });

  it('语言识别不出时不渲染入口（点了必然失败）', () => {
    render(
      <DiagnosticQuickFix
        projectPath="/p"
        languageId={null}
        uri="file:///p/main.go"
        diagnostic={DIAG}
      />,
    );
    expect(screen.queryByTestId('diagnostic-quickfix-button')).not.toBeInTheDocument();
  });

  it('点击灯泡拉一次 codeAction 并列出可执行动作（平铺单列）', async () => {
    render(
      <DiagnosticQuickFix
        projectPath="/p"
        languageId="go"
        uri="file:///p/main.go"
        diagnostic={DIAG}
      />,
    );
    expect(screen.queryByTestId('diagnostic-quickfix-menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('diagnostic-quickfix-button'));

    expect(await screen.findByTestId('diagnostic-quickfix-menu')).toBeInTheDocument();
    expect(requestCodeActions).toHaveBeenCalledTimes(1);
    // 只列带 edit 的修复 + 末尾 AI 动作
    expect(screen.getByTestId('diagnostic-quickfix-Add import: "fmt"')).toBeInTheDocument();
    // source.* 与 command-only 动作不铺进菜单（VS Code 只列可应用的修复）
    expect(screen.queryByTestId('diagnostic-quickfix-Organize Imports')).not.toBeInTheDocument();
    expect(screen.queryByTestId('diagnostic-quickfix-Browse assembly')).not.toBeInTheDocument();
    expect(screen.getByTestId('diagnostic-quickfix-ai-fix')).toBeInTheDocument();
    expect(screen.getByTestId('diagnostic-quickfix-ai-explain')).toBeInTheDocument();
  });

  it('选中动作即应用，并带上完整的原始动作（含 edit）', async () => {
    render(
      <DiagnosticQuickFix
        projectPath="/p"
        languageId="go"
        uri="file:///p/main.go"
        diagnostic={DIAG}
      />,
    );
    fireEvent.click(screen.getByTestId('diagnostic-quickfix-button'));
    expect(await screen.findByTestId('diagnostic-quickfix-menu')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('diagnostic-quickfix-Add import: "fmt"'));

    expect(applyCodeAction).toHaveBeenCalledTimes(1);
    const [uri, action] = vi.mocked(applyCodeAction).mock.calls[0];
    expect(uri).toBe('file:///p/main.go');
    expect(action.title).toBe('Add import: "fmt"');
    expect(action.edit).toEqual({ changes: {} });
    // 应用成功后菜单关闭
    await waitFor(() =>
      expect(screen.queryByTestId('diagnostic-quickfix-menu')).not.toBeInTheDocument(),
    );
  });

  it('菜单 portal 到滚动容器之外 —— 否则会被 overflow 裁掉（"下拉列表被遮挡"）', async () => {
    // 复刻 Problems 面板的滚动容器：菜单若留在其中就会被父级裁切
    render(
      <div data-testid="scroll-container" className="overflow-y-auto">
        <DiagnosticQuickFix
          projectPath="/p"
          languageId="go"
          uri="file:///p/main.go"
          diagnostic={DIAG}
        />
      </div>,
    );
    fireEvent.click(screen.getByTestId('diagnostic-quickfix-button'));

    const menu = await screen.findByTestId('diagnostic-quickfix-menu');
    expect(
      within(screen.getByTestId('scroll-container')).queryByTestId('diagnostic-quickfix-menu'),
    ).not.toBeInTheDocument();
    expect(menu).toHaveClass('fixed');
  });

  it('服务器零动作时菜单仍提供 AI 动作（不再有空白菜单）', async () => {
    vi.mocked(requestCodeActions).mockResolvedValue([]);
    render(
      <DiagnosticQuickFix
        projectPath="/p"
        languageId="go"
        uri="file:///p/main.go"
        diagnostic={DIAG}
      />,
    );
    fireEvent.click(screen.getByTestId('diagnostic-quickfix-button'));
    expect(await screen.findByTestId('diagnostic-quickfix-ai-fix')).toBeInTheDocument();
    expect(screen.getByTestId('diagnostic-quickfix-ai-explain')).toBeInTheDocument();
    expect(screen.queryByTestId('diagnostic-quickfix-empty')).not.toBeInTheDocument();
  });

  it('AI 行（✨ Fix）点击派发注册表（B1），不经服务器 edit，成功后关菜单', async () => {
    vi.mocked(runAiQuickFixAction).mockClear();
    render(
      <DiagnosticQuickFix
        projectPath="/p"
        languageId="go"
        uri="file:///p/main.go"
        diagnostic={DIAG}
      />,
    );
    fireEvent.click(screen.getByTestId('diagnostic-quickfix-button'));
    await screen.findByTestId('diagnostic-quickfix-menu');

    fireEvent.click(screen.getByTestId('diagnostic-quickfix-ai-fix'));

    expect(runAiQuickFixAction).toHaveBeenCalledTimes(1);
    const [uri, diagnostic, ai] = vi.mocked(runAiQuickFixAction).mock.calls[0];
    expect(uri).toBe('file:///p/main.go');
    expect(diagnostic).toEqual(DIAG);
    expect(ai).toBe('fix');
    expect(applyCodeAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByTestId('diagnostic-quickfix-menu')).not.toBeInTheDocument(),
    );
  });

  it('AI 行（✨ Explain）点击派发 explain', async () => {
    vi.mocked(runAiQuickFixAction).mockClear();
    render(
      <DiagnosticQuickFix
        projectPath="/p"
        languageId="go"
        uri="file:///p/main.go"
        diagnostic={DIAG}
      />,
    );
    fireEvent.click(screen.getByTestId('diagnostic-quickfix-button'));
    await screen.findByTestId('diagnostic-quickfix-menu');

    fireEvent.click(screen.getByTestId('diagnostic-quickfix-ai-explain'));

    expect(vi.mocked(runAiQuickFixAction).mock.calls[0][2]).toBe('explain');
  });

  it('AI 行派发失败（编辑器未打开）时菜单保持打开让用户看到', async () => {
    vi.mocked(runAiQuickFixAction).mockClear();
    vi.mocked(runAiQuickFixAction).mockReturnValue(false);
    render(
      <DiagnosticQuickFix
        projectPath="/p"
        languageId="go"
        uri="file:///p/main.go"
        diagnostic={DIAG}
      />,
    );
    fireEvent.click(screen.getByTestId('diagnostic-quickfix-button'));
    await screen.findByTestId('diagnostic-quickfix-menu');

    fireEvent.click(screen.getByTestId('diagnostic-quickfix-ai-fix'));

    expect(screen.getByTestId('diagnostic-quickfix-menu')).toBeInTheDocument();
  });
});

describe('#3 面板菜单的键盘导航', () => {
  const press = (key: string) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  beforeEach(() => {
    vi.mocked(requestCodeActions).mockReset();
    vi.mocked(applyCodeAction).mockReset();
    vi.mocked(requestCodeActions).mockResolvedValue([
      { title: 'Preferred', kind: 'quickfix', edit: {}, isPreferred: true },
      { title: 'Command only', kind: 'quickfix', command: { command: 'gopls.x' } },
      { title: 'Other', kind: 'quickfix', edit: {} },
    ]);
    vi.mocked(applyCodeAction).mockReturnValue(true);
  });

  async function openMenu() {
    render(
      <DiagnosticQuickFix
        projectPath="/p"
        languageId="go"
        uri="file:///p/a.go"
        diagnostic={DIAG}
      />,
    );
    fireEvent.click(screen.getByTestId('diagnostic-quickfix-button'));
    await screen.findByTestId('diagnostic-quickfix-Preferred');
  }

  it('↓ 移向下一动作后 Enter 应用高亮项（command-only 不再入列）', async () => {
    await openMenu();

    press('ArrowDown'); // Preferred → Other
    press('Enter');

    expect(applyCodeAction).toHaveBeenCalledTimes(1);
    const [, action] = vi.mocked(applyCodeAction).mock.calls[0];
    expect(action.title).toBe('Other');
  });

  it('Esc 关闭菜单', async () => {
    await openMenu();
    press('Escape');
    // React 状态更新是异步的：关闭要等一轮渲染后再断言
    await waitFor(() =>
      expect(screen.queryByTestId('diagnostic-quickfix-menu')).not.toBeInTheDocument(),
    );
  });
});
