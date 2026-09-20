// @vitest-environment node
/**
 * codeAction 通道：请求参数形态（含诊断 `data`）、降级、以及"只有 command 的动作
 * 不进菜单"这条边界。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runAiActionForUri } from '@/features/editor/api/aiActionRegistry';

import { applyWorkspaceEdit } from '../../hooks/lspWorkspaceEdit';
import {
  applyCodeAction,
  groupQuickFixActions,
  requestCodeActions,
  runAiQuickFixAction,
} from '../codeAction';
import { lspRequest } from '../lspApi';

vi.mock('../lspApi', () => ({ lspRequest: vi.fn() }));
// 注册表与编辑器解耦：这里直接决定"有没有打开的页"
vi.mock('@/features/editor/api/editorViews', () => ({
  resolveEditorViewFromUri: vi.fn(),
}));
// AI 动作派发：诊断 UI 不直接依赖编辑器 hook，经注册表解耦
vi.mock('@/features/editor/api/aiActionRegistry', () => ({
  runAiActionForUri: vi.fn(() => true),
}));
vi.mock('../../hooks/lspWorkspaceEdit', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/lspWorkspaceEdit')>(
    '../../hooks/lspWorkspaceEdit',
  );
  return { ...actual, applyWorkspaceEdit: vi.fn(() => true) };
});

const URI = 'file:///proj/main.go';
const RANGE = {
  start: { line: 3, character: 1 },
  end: { line: 3, character: 5 },
};

describe('requestCodeActions', () => {
  beforeEach(() => {
    vi.mocked(lspRequest).mockReset();
  });

  it('按 LSP 语义带 uri / range / context.diagnostics（含 data）', async () => {
    vi.mocked(lspRequest).mockResolvedValue([]);
    const diagnostic = {
      range: RANGE,
      severity: 1,
      message: 'undefined: fmt',
      source: 'gopls',
      data: { kind: 'AddImport' },
    };

    await requestCodeActions('/proj', 'go', URI, RANGE, [diagnostic]);

    expect(lspRequest).toHaveBeenCalledTimes(1);
    const [projectPath, languageId, method, params] = vi.mocked(lspRequest).mock.calls[0];
    expect(projectPath).toBe('/proj');
    expect(languageId).toBe('go');
    expect(method).toBe('textDocument/codeAction');
    expect(params.textDocument.uri).toBe(URI);
    expect(params.range).toBe(RANGE);
    // 诊断原样透传 —— 服务器可能靠 data 匹配 quickfix
    expect(params.context.diagnostics[0].data).toEqual({ kind: 'AddImport' });
  });

  it('服务端返回 null 时降级为空数组', async () => {
    vi.mocked(lspRequest).mockResolvedValue(null);
    await expect(requestCodeActions('/proj', 'go', URI, RANGE, [])).resolves.toEqual([]);
  });

  it('请求失败时降级为空数组（诊断行只是没有灯泡）', async () => {
    vi.mocked(lspRequest).mockRejectedValue(new Error('boom'));
    await expect(requestCodeActions('/proj', 'go', URI, RANGE, [])).resolves.toEqual([]);
  });
});

describe('groupQuickFixActions（VS Code 平铺形态）', () => {
  const sections = groupQuickFixActions([
    { title: 'Add import: "fmt"', kind: 'quickfix', edit: { changes: {} }, isPreferred: true },
    { title: 'Browse assembly', kind: 'source.assembly', command: { command: 'gopls.assembly' } },
    { title: 'Organize Imports', kind: 'source.organizeImports', edit: { changes: {} } },
    { title: 'Command only fix', kind: 'quickfix', command: { command: 'gopls.fix' } },
  ]);

  it('只列一个 Quick Fix 组（无 Source Action 分组头）', () => {
    expect(sections.map((s) => s.header)).toEqual(['Quick Fix']);
  });

  it('只列带 edit 的修复动作；command-only 与 source.* 不铺进菜单', () => {
    // Browse assembly / Organize Imports（source.*）与 Command only fix（无 edit）都不可见
    const titles = sections[0].items.map((i) => i.title);
    expect(titles).toContain('Add import: "fmt"');
    expect(titles).not.toContain('Browse assembly');
    expect(titles).not.toContain('Organize Imports');
    expect(titles).not.toContain('Command only fix');
  });

  it('AI 动作固定追加在列表末尾（sparkle 区分来源）', () => {
    expect(sections[0].items.slice(-2)).toEqual([
      { title: 'Fix', ai: 'fix' },
      { title: 'Explain', ai: 'explain' },
    ]);
  });

  it('服务器零动作时菜单仍提供 AI 动作（B1：agent 自己修）', () => {
    const aiOnly = groupQuickFixActions([]);
    expect(aiOnly[0].items.map((i) => i.ai)).toEqual(['fix', 'explain']);
  });

  it('isPreferred 由服务器决定：首选排到最前（AI 项固定末尾）', () => {
    const laterPreferred = groupQuickFixActions([
      { title: 'plain', kind: 'quickfix', edit: { changes: {} } },
      { title: 'preferred', kind: 'quickfix', edit: { changes: {} }, isPreferred: true },
    ]);
    expect(laterPreferred[0].items.filter((i) => !i.ai).map((i) => i.title)).toEqual([
      'preferred',
      'plain',
    ]);
  });
});

describe('runAiQuickFixAction', () => {
  it('LSP 0-based 诊断行换算为 1-based 行范围，并携带诊断消息派发', () => {
    vi.mocked(runAiActionForUri).mockClear();
    vi.mocked(runAiActionForUri).mockReturnValue(true);

    const ok = runAiQuickFixAction(
      URI,
      {
        range: { start: { line: 3, character: 1 }, end: { line: 3, character: 5 } },
        severity: 1,
        message: 'undefined: fmt',
        source: 'gopls',
      },
      'fix',
    );

    expect(ok).toBe(true);
    expect(runAiActionForUri).toHaveBeenCalledWith(URI, {
      action: 'fix',
      startLine: 4,
      endLine: 4,
      diagnosticMessage: 'undefined: fmt',
    });
  });

  it('跨行诊断保留完整行范围', () => {
    vi.mocked(runAiActionForUri).mockClear();
    runAiQuickFixAction(
      URI,
      {
        range: { start: { line: 2, character: 0 }, end: { line: 5, character: 0 } },
        severity: 1,
        message: 'mismatched types',
        source: null,
      },
      'explain',
    );

    expect(runAiActionForUri).toHaveBeenCalledWith(
      URI,
      expect.objectContaining({ action: 'explain', startLine: 3, endLine: 6 }),
    );
  });

  it('注册表没有命中（编辑器未打开）时返回 false', () => {
    vi.mocked(runAiActionForUri).mockReturnValue(false);
    expect(
      runAiQuickFixAction(
        URI,
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 1,
          message: 'm',
          source: null,
        },
        'fix',
      ),
    ).toBe(false);
  });
});

describe('applyCodeAction', () => {
  it('command-only 的动作不执行且返回 false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ok = applyCodeAction(URI, { title: 'x', command: { command: 'gopls.assembly' } });
    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('带 edit 的动作交给 applyWorkspaceEdit', () => {
    const ok = applyCodeAction(URI, { title: 'Add import', edit: { changes: {} } });
    expect(ok).toBe(true);
  });

  it('F1 · 注入桩 resolver：转发 uri/edit/resolver 给 applyWorkspaceEdit（不依赖 editor 真实现）', () => {
    vi.mocked(applyWorkspaceEdit).mockClear();
    const stub = vi.fn(() => null);
    const edit = { changes: {} };
    applyCodeAction(URI, { title: 'Add import', edit }, stub);
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(edit, URI, stub);
  });

  it('F1 · 默认 resolver 即 editorViews 的 resolveEditorViewFromUri（调用方零改动）', async () => {
    vi.mocked(applyWorkspaceEdit).mockClear();
    const { resolveEditorViewFromUri } = await import('@/features/editor/api/editorViews');
    const edit = { changes: {} };
    applyCodeAction(URI, { title: 'Add import', edit });
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(edit, URI, resolveEditorViewFromUri);
  });
});
