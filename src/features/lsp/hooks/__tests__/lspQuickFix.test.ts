/**
 * 编辑器内 quickfix：键位触发、诊断定位（重叠取最具体）、菜单渲染与应用。
 *
 * 环境为全局 jsdom —— 这里构造**真实** EditorView（仓内已有先例：
 * `src/features/editor/__tests__/navigateCaret.test.ts`），因为 coordsAtPos /
 * 事件冒泡这些行为用桩替身测不出来。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerAiActionHandler,
  unregisterAiActionHandler,
} from '@/features/editor/api/aiActionRegistry';
import { fileRefFromLspUri, tabIdentityOf } from '@/shared/utils/fileRef';

import { useLspStore } from '../../store/lspStore';
import type { LspDiagnostic } from '../../types';
import {
  appendShortcutRow,
  createDiagnosticPopup,
  diagnosticAtPosition,
  lspQuickFix,
  openQuickFixAt,
  quickFixKeyBindings,
  runAiFixAt,
  shortcutHint,
  showQuickFixMenu,
} from '../lspQuickFix';

// 键位提示文案依平台分支（Mod-I 的 mac 形态）；本文件统一按 mac 断言
vi.mock('@/shared/utils/platform', () => ({ IS_MACOS: true }));

vi.mock('../../api/codeAction', async () => ({
  // 分组用**真实实现**：它正是被测对象的一半，mock 掉就测不到分组契约（原型 M3-2）
  ...(await vi.importActual<typeof import('../../api/codeAction')>('../../api/codeAction')),
  requestCodeActions: vi.fn(),
  applyCodeAction: vi.fn(() => true),
}));

const { requestCodeActions, applyCodeAction } = await import('../../api/codeAction');

const URI = 'file:///proj/main.go';
const DOC = 'package main\n\nfunc main() {\n\tfmt.Println("hi")\n}\n';

const DIAGNOSTIC: LspDiagnostic = {
  range: { start: { line: 3, character: 1 }, end: { line: 3, character: 4 } },
  severity: 1,
  message: 'undefined: fmt',
  source: 'gopls',
  data: { kind: 'AddImport' },
};

const ACTIONS = [
  { title: 'Add import: "fmt"', kind: 'quickfix', edit: { changes: {} } },
  { title: 'Browse assembly', command: { command: 'gopls.assembly' } },
];

function makeView() {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc: DOC }),
    parent,
  });
  return view;
}

const CTX = { projectPath: '/proj', uri: URI, getLanguageId: () => 'go' };

/** 装了键位的视图（键位扩展需在 state 创建时装配，事后 appendConfig 不生效）。 */
function makeViewWithKeys() {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({ doc: DOC, extensions: [lspQuickFix(CTX)] }),
    parent,
  });
}

describe('diagnosticAtPosition', () => {
  it('命中包含光标位置的诊断', () => {
    expect(diagnosticAtPosition([DIAGNOSTIC], { line: 3, character: 2 })).toBe(DIAGNOSTIC);
  });

  it('光标不在任何诊断范围内 → null', () => {
    expect(diagnosticAtPosition([DIAGNOSTIC], { line: 0, character: 0 })).toBeNull();
  });

  it('区间重叠时取跨度最小的那条（最具体的诊断）', () => {
    const wide: LspDiagnostic = {
      ...DIAGNOSTIC,
      range: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } },
    };
    expect(diagnosticAtPosition([wide, DIAGNOSTIC], { line: 3, character: 2 })).toBe(DIAGNOSTIC);
  });
});

describe('openQuickFixAt', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.mocked(requestCodeActions).mockReset();
    vi.mocked(applyCodeAction).mockReset();
    vi.mocked(requestCodeActions).mockResolvedValue(ACTIONS);
    vi.mocked(applyCodeAction).mockReturnValue(true);
    useLspStore.setState({ diagnosticsByProject: { '/proj': { [URI]: [DIAGNOSTIC] } } });
  });

  it('没有语言 ID（会话未就绪）时不接管', () => {
    const view = makeView();
    expect(openQuickFixAt(view, { ...CTX, getLanguageId: () => null })).toBe(false);
    expect(requestCodeActions).not.toHaveBeenCalled();
    view.destroy();
  });

  it('光标处没有诊断时不接管、不发请求', () => {
    const view = makeView();
    view.dispatch({ selection: { anchor: 0 } });
    expect(openQuickFixAt(view, CTX)).toBe(false);
    expect(requestCodeActions).not.toHaveBeenCalled();
    view.destroy();
  });

  it('带诊断请求一次 codeAction 并弹出菜单，选中即应用', async () => {
    const view = makeView();
    // 光标落在 fmt 上（第 4 行 \tfmt.Println）
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

    expect(openQuickFixAt(view, CTX)).toBe(true);

    // 等**最终**菜单（含动作项）出现：加载态菜单会被替换，抓到它就会误判
    await vi.waitFor(() => {
      if (!document.querySelector('[data-testid=\'editor-quickfix-Add import: "fmt"\']')) {
        throw new Error('menu not ready');
      }
    });
    const menu = document.querySelector('[data-testid="editor-quickfix-menu"]') as HTMLElement;
    // 菜单挂在 body 上（脱离编辑器可能的 overflow 容器）
    expect(menu.parentElement).toBe(document.body);

    expect(requestCodeActions).toHaveBeenCalledTimes(1);
    const [, languageId, uri, range, diagnostics] = vi.mocked(requestCodeActions).mock.calls[0];
    expect(languageId).toBe('go');
    expect(uri).toBe(URI);
    expect(range).toEqual(DIAGNOSTIC.range);
    // 原始诊断（含 data）原样带过去
    expect(diagnostics[0].data).toEqual({ kind: 'AddImport' });

    // command-only 的动作不铺进菜单（VS Code 只列可应用的修复）
    expect(document.querySelector('[data-testid="editor-quickfix-Browse assembly"]')).toBeNull();

    const item = document.querySelector(
      '[data-testid=\'editor-quickfix-Add import: "fmt"\']',
    ) as HTMLElement;
    expect(item).toBeTruthy();
    item.click();

    expect(applyCodeAction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyCodeAction).mock.calls[0][0]).toBe(URI);
    // 选中即关：点击后菜单必须从页面上移除，不固定残留（VS Code 同构）
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="editor-quickfix-menu"]')) {
        throw new Error('menu should close after pick');
      }
    });
    view.destroy();
  });

  it('菜单 AI 行点击后同样关闭菜单（不固定在页面上）', async () => {
    const handler = vi.fn(() => true);
    registerAiActionHandler(tabIdentityOf(fileRefFromLspUri(URI)!), handler);
    const view = makeView();
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

    openQuickFixAt(view, CTX);
    await vi.waitFor(() => {
      if (!document.querySelector('[data-testid="editor-quickfix-ai-fix"]')) {
        throw new Error('AI row not rendered');
      }
    });

    (document.querySelector('[data-testid="editor-quickfix-ai-fix"]') as HTMLElement).click();
    expect(handler).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="editor-quickfix-menu"]')) {
        throw new Error('menu should close after AI pick');
      }
    });
    view.destroy();
    unregisterAiActionHandler(tabIdentityOf(fileRefFromLspUri(URI)!));
  });

  it('服务器零动作时菜单仍提供 AI 动作（不再有空白菜单）', async () => {
    vi.mocked(requestCodeActions).mockResolvedValue([]);
    registerAiActionHandler(tabIdentityOf(fileRefFromLspUri(URI)!), () => true);
    const view = makeView();
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

    openQuickFixAt(view, CTX);

    await vi.waitFor(() => {
      if (!document.querySelector('[data-testid="editor-quickfix-ai-explain"]')) {
        throw new Error('AI items not rendered');
      }
    });
    expect(document.querySelector('[data-testid="editor-quickfix-empty"]')).toBeNull();
    view.destroy();
    unregisterAiActionHandler(tabIdentityOf(fileRefFromLspUri(URI)!));
  });

  it('Esc 关闭菜单', async () => {
    const view = makeView();
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });
    openQuickFixAt(view, CTX);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="editor-quickfix-menu"]')).toBeTruthy(),
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('[data-testid="editor-quickfix-menu"]')).toBeNull();
    view.destroy();
  });
});

describe('lspQuickFix 键位', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.mocked(requestCodeActions).mockReset();
    vi.mocked(requestCodeActions).mockResolvedValue(ACTIONS);
    useLspStore.setState({ diagnosticsByProject: { '/proj': { [URI]: [DIAGNOSTIC] } } });
  });

  const press = (view: EditorView, key: string, init: KeyboardEventInit) => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  };

  it('Alt-Enter 打开菜单', async () => {
    const view = makeViewWithKeys();
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

    press(view, 'Enter', { altKey: true });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="editor-quickfix-menu"]')).toBeTruthy(),
    );
    view.destroy();
  });

  it('键位与 tooltip 提示一一对应：Alt-Enter / Mod-. / Mod-i / F2', async () => {
    // 直接断言 key 串 + 调用 run：`Mod-` 的平台映射依 navigator.platform，
    // 用合成事件验证会因 jsdom 无 mac 身份而假红。
    const bindings = quickFixKeyBindings(CTX);
    expect(bindings.map((b) => b.key)).toEqual(['Alt-Enter', 'Mod-.', 'Mod-i', 'F2']);

    // Mod-i 需要 AI handler 在位（编辑器页已打开的语义）
    registerAiActionHandler(tabIdentityOf(fileRefFromLspUri(URI)!), () => true);
    for (const binding of bindings) {
      const view = makeViewWithKeys();
      view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

      expect(binding.run?.(view)).toBe(true);
      view.destroy();
      document.body.innerHTML = '';
    }
    unregisterAiActionHandler(tabIdentityOf(fileRefFromLspUri(URI)!));
  });

  it('Mod-. 在服务器声明首选时直接应用，不弹菜单（Fix 语义）', async () => {
    vi.mocked(requestCodeActions).mockResolvedValue([
      { title: 'Fix it', kind: 'quickfix', edit: { changes: {} }, isPreferred: true },
    ]);
    const view = makeViewWithKeys();
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

    quickFixKeyBindings(CTX)[1].run?.(view);

    await vi.waitFor(() => expect(applyCodeAction).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[data-testid="editor-quickfix-menu"]')).toBeNull();
    view.destroy();
  });
});

describe('#31 tooltip 入口与 gutter 灯泡', () => {
  // 诊断放在**首行**：jsdom 的视口高度为 0，CodeMirror 只渲染首屏行，
  // 非首屏的 gutter 标记不会出现在 DOM 里（测试环境限制，非产品行为）。
  const CM_DIAGNOSTIC: Diagnostic = {
    from: 0,
    to: 3,
    severity: 'error',
    message: 'undefined: pkg',
    source: 'gopls',
  };
  const LINE0_DIAGNOSTIC: LspDiagnostic = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    severity: 1,
    message: 'undefined: pkg',
    source: 'gopls',
    data: { kind: 'AddImport' },
  };

  /** 装好扩展、喂一条 lint 诊断，并等补挂 action 的微任务完成。 */
  async function setupWithDiagnostic() {
    document.body.innerHTML = '';
    vi.mocked(requestCodeActions).mockReset();
    vi.mocked(requestCodeActions).mockResolvedValue(ACTIONS);
    useLspStore.setState({ diagnosticsByProject: { '/proj': { [URI]: [LINE0_DIAGNOSTIC] } } });

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [lspQuickFix(CTX)] }),
      parent,
    });
    view.dispatch(setDiagnostics(view.state, [CM_DIAGNOSTIC]));

    // 等 gutter 灯泡渲染出来（诊断 → 标记是同步的，但 CM 的排版是异步的）
    await vi.waitFor(() => expect(document.querySelector('.cm-neeko-quickfix-bulb')).toBeTruthy());
    return view;
  }

  it('popup 消息行复用 Problems 行样式：severity 图标 + 消息 + source + (code)，动作容器同根', () => {
    const { dom, body } = createDiagnosticPopup({
      ...LINE0_DIAGNOSTIC,
      source: 'gopls',
      code: 'E0106',
    });

    expect(dom.getAttribute('data-testid')).toBe('editor-diagnostic-popup');
    // 消息与 Problems 行同构：图标（severity 标记）+ 消息 + source + (code)
    expect(dom.querySelector('svg.lucide-circle-x')).toBeTruthy();
    const message = dom.querySelector('[data-testid="editor-diagnostic-popup-message"]');
    expect(message?.textContent).toBe('undefined: pkg');
    expect(dom.textContent).toContain('gopls');
    expect(dom.textContent).toContain('(E0106)');
    // 动作行在消息之下，与 popup 同根（CodeMirror 记录的是这个根节点）
    expect(body.parentElement).toBe(dom);
  });

  it('@codemirror/lint 补丁在位：宿主接管时内置 tooltip 让位', () => {
    const dist = readFileSync(
      join(process.cwd(), 'node_modules/@codemirror/lint/dist/index.js'),
      'utf8',
    );
    // 补丁丢失时两个 tooltip 会同时弹出（不该静默）
    expect(dist).toContain('neeko-lint-tooltip-owner');
  });

  it('有诊断的行渲染 gutter 灯泡', async () => {
    const view = await setupWithDiagnostic();

    await vi.waitFor(() => expect(document.querySelector('.cm-neeko-quickfix-bulb')).toBeTruthy());
    // 同一行多条诊断只放一个灯泡
    expect(document.querySelectorAll('.cm-neeko-quickfix-bulb')).toHaveLength(1);
    view.destroy();
  });

  it('点击 gutter 灯泡打开 quickfix 菜单', async () => {
    const view = await setupWithDiagnostic();
    const bulb = await vi.waitFor(() => {
      const el = document.querySelector('.cm-neeko-quickfix-bulb');
      if (!el) throw new Error('bulb not rendered');
      return el as HTMLElement;
    });

    bulb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="editor-quickfix-menu"]')).toBeTruthy(),
    );
    view.destroy();
  });
});

describe('#31 原型对齐（M3-1 灯泡只在红色诊断行 / M3-2 平铺菜单）', () => {
  const SRC_ACTIONS = [
    { title: 'Import "fmt"', kind: 'quickfix', edit: { changes: {} } },
    { title: 'Organize Imports', kind: 'source.organizeImports', edit: { changes: {} } },
  ];

  async function openMenuAtLine0(diagnostics: LspDiagnostic[]) {
    document.body.innerHTML = '';
    vi.mocked(requestCodeActions).mockReset();
    vi.mocked(requestCodeActions).mockResolvedValue(SRC_ACTIONS);
    useLspStore.setState({ diagnosticsByProject: { '/proj': { [URI]: diagnostics } } });

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [lspQuickFix(CTX)] }),
      parent,
    });
    const opened = openQuickFixAt(view, CTX, 0);
    if (opened) {
      await vi.waitFor(() =>
        expect(document.querySelector('[data-testid="editor-quickfix-menu"]')).toBeTruthy(),
      );
    }
    return view;
  }

  const LINE0: LspDiagnostic = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    severity: 1,
    message: 'undefined: fmt',
    source: 'gopls',
  };

  it('菜单平铺单列（VS Code 形态）：只列带 edit 的修复 + 末尾 AI 动作', async () => {
    const view = await openMenuAtLine0([LINE0]);

    const menu = document.querySelector('[data-testid="editor-quickfix-menu"]') as HTMLElement;
    // 无分组头
    expect(menu.textContent).not.toContain('Quick Fix');
    expect(menu.textContent).not.toContain('Source Action');

    // 可执行项：带灯泡，可点
    const quick = document.querySelector(
      '[data-testid=\'editor-quickfix-Import "fmt"\']',
    ) as HTMLButtonElement;
    expect(quick).toBeTruthy();
    expect(quick.disabled).toBe(false);

    // source.* 动作不铺进菜单（不是这个诊断的修复动作）
    expect(document.querySelector('[data-testid="editor-quickfix-Organize Imports"]')).toBeNull();

    // AI 动作固定在末尾（sparkle 条目）
    expect(document.querySelector('[data-testid="editor-quickfix-ai-fix"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="editor-quickfix-ai-explain"]')).toBeTruthy();

    view.destroy();
  });

  it('灯泡只在红色（error）诊断行出现', async () => {
    document.body.innerHTML = '';
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [lspQuickFix(CTX)] }),
      parent,
    });
    view.dispatch(
      setDiagnostics(view.state, [{ from: 0, to: 3, severity: 'warning', message: 'careful' }]),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 警告行不放灯泡（原型 M3-1）
    expect(document.querySelectorAll('.cm-neeko-quickfix-bulb')).toHaveLength(0);
    view.destroy();
  });
});

describe('#3 编辑器内菜单的键盘导航', () => {
  const SECTIONS = [
    {
      header: 'Quick Fix',
      items: [
        { title: 'Preferred', hint: 'gopls', preferred: true, onPick: vi.fn() },
        { title: 'Command only', disabledHint: '需 executeCommand · 首版不做' },
        { title: 'Other', onPick: vi.fn() },
      ],
    },
    {
      header: 'Source Action',
      items: [{ title: 'Organize Imports', disabledHint: '首版不做 · 留扩展点' }],
    },
  ];

  const press = (key: string) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  const rowOf = (title: string) =>
    document.querySelector(`[data-testid="editor-quickfix-${title}"]`) as HTMLButtonElement;

  function open() {
    document.body.innerHTML = '';
    SECTIONS[0].items[0].onPick = vi.fn();
    SECTIONS[0].items[2].onPick = vi.fn();
    showQuickFixMenu(
      { getBoundingClientRect: () => ({ top: 10, bottom: 30, left: 10 }) as DOMRect },
      SECTIONS,
    );
  }

  it('打开时高亮停在服务器声明的首选（isPreferred）', () => {
    open();
    // 用 classList 精确判类名：`hover:bg-[var(--bg-hover)]` 会让 className 子串匹配失真
    expect(rowOf('Preferred').classList.contains('bg-[var(--bg-hover)]')).toBe(true);
    expect(rowOf('Other').classList.contains('bg-[var(--bg-hover)]')).toBe(false);
  });

  it('↓ 跳过置灰项；↑ 回到上一个可执行项', () => {
    open();
    press('ArrowDown');
    expect(rowOf('Other').classList.contains('bg-[var(--bg-hover)]')).toBe(true); // 跨过 Command only
    expect(rowOf('Preferred').classList.contains('bg-[var(--bg-hover)]')).toBe(false);

    press('ArrowUp');
    expect(rowOf('Preferred').classList.contains('bg-[var(--bg-hover)]')).toBe(true);
  });

  it('到达边界停住（不回绕）', () => {
    open();
    press('ArrowDown');
    press('ArrowDown'); // 已在最后一项，再按不动
    expect(rowOf('Other').classList.contains('bg-[var(--bg-hover)]')).toBe(true);
  });

  it('Enter 应用高亮项', () => {
    open();
    press('Enter');
    expect(SECTIONS[0].items[0].onPick).toHaveBeenCalledTimes(1);
  });
});

describe('M3 AI 动作（✨ Fix / ✨ Explain，B1：agent 自己改文件）', () => {
  const AI_IDENTITY = tabIdentityOf(fileRefFromLspUri(URI)!);

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.mocked(requestCodeActions).mockReset();
    vi.mocked(applyCodeAction).mockReset();
    vi.mocked(requestCodeActions).mockResolvedValue(ACTIONS);
    vi.mocked(applyCodeAction).mockReturnValue(true);
    useLspStore.setState({ diagnosticsByProject: { '/proj': { [URI]: [DIAGNOSTIC] } } });
  });

  afterEach(() => {
    unregisterAiActionHandler(AI_IDENTITY);
  });

  it('Mod-i 派发 AI Fix：1-based 诊断行 + 诊断消息，不经服务器 edit 路径', () => {
    const handler = vi.fn(() => true);
    registerAiActionHandler(AI_IDENTITY, handler);
    const view = makeView();
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

    const binding = quickFixKeyBindings(CTX).find((b) => b.key === 'Mod-i');
    expect(binding?.run?.(view)).toBe(true);

    expect(handler).toHaveBeenCalledWith({
      action: 'fix',
      startLine: 4, // DIAGNOSTIC 在 line 3（0-based）
      endLine: 4,
      diagnosticMessage: 'undefined: fmt',
    });
    expect(applyCodeAction).not.toHaveBeenCalled();
    view.destroy();
  });

  it('Mod-i 光标处无诊断时不接管、不派发', () => {
    const handler = vi.fn(() => true);
    registerAiActionHandler(AI_IDENTITY, handler);
    const view = makeView();
    view.dispatch({ selection: { anchor: 0 } });

    const binding = quickFixKeyBindings(CTX).find((b) => b.key === 'Mod-i');
    expect(binding?.run?.(view)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    view.destroy();
  });

  it('hover 动作行的 ✨ Fix 与键位共用 runAiFixAt', () => {
    const handler = vi.fn(() => true);
    registerAiActionHandler(AI_IDENTITY, handler);
    const view = makeView();
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

    expect(runAiFixAt(view, CTX)).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('runAiFixAt 按显式 pos 解析诊断 —— popup 快捷行传 hover pos，不取光标处', () => {
    const hovered: LspDiagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      severity: 1,
      message: 'undefined: pkg',
      source: 'gopls',
    };
    useLspStore.setState({ diagnosticsByProject: { '/proj': { [URI]: [hovered, DIAGNOSTIC] } } });
    const handler = vi.fn(() => true);
    registerAiActionHandler(AI_IDENTITY, handler);
    const view = makeView();
    // 光标停在 fmt（line 3），hover 的诊断在 line 0
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

    expect(runAiFixAt(view, CTX, 0)).toBe(true);
    expect(handler).toHaveBeenCalledWith({
      action: 'fix',
      startLine: 1, // hovered 在 line 0（0-based）
      endLine: 1,
      diagnosticMessage: 'undefined: pkg',
    });
    view.destroy();
  });

  it('openQuickFixAt 按显式 pos 打开 hover 处诊断的菜单 —— popup Quick Fix… 行同源', async () => {
    const hovered: LspDiagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      severity: 1,
      message: 'undefined: pkg',
      source: 'gopls',
    };
    useLspStore.setState({ diagnosticsByProject: { '/proj': { [URI]: [hovered, DIAGNOSTIC] } } });
    const view = makeView();
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

    expect(openQuickFixAt(view, CTX, 0)).toBe(true);
    await vi.waitFor(() => {
      expect(requestCodeActions).toHaveBeenCalledTimes(1);
      const [, , , range] = vi.mocked(requestCodeActions).mock.calls[0];
      expect(range).toEqual(hovered.range);
    });
    view.destroy();
  });

  it('菜单末尾的 AI 行点击派发注册表（✨ Fix）', async () => {
    const handler = vi.fn(() => true);
    registerAiActionHandler(AI_IDENTITY, handler);
    const view = makeView();
    view.dispatch({ selection: { anchor: DOC.indexOf('fmt') + 1 } });

    openQuickFixAt(view, CTX);
    await vi.waitFor(() => {
      if (!document.querySelector('[data-testid="editor-quickfix-ai-fix"]')) {
        throw new Error('AI row not rendered');
      }
    });

    (document.querySelector('[data-testid="editor-quickfix-ai-fix"]') as HTMLElement).click();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fix', diagnosticMessage: 'undefined: fmt' }),
    );
    expect(applyCodeAction).not.toHaveBeenCalled();
    view.destroy();
  });

  it('popup = Problems 行样式消息，不内嵌 quickfix 菜单', () => {
    const { dom, body } = createDiagnosticPopup({
      ...DIAGNOSTIC,
      source: 'gopls',
      code: 'E0106',
    });
    const head = dom.querySelector('[data-testid="editor-diagnostic-popup-message"]');
    expect(head?.textContent).toBe('undefined: fmt');
    // 严重度图标与消息同行（复用 Problems 行样式）
    expect(dom.querySelector('svg.lucide-circle-x')).toBeTruthy();
    // 动作容器在消息之下；菜单/加载态不在此处（Quick Fix… 打开 picker 时才拉取）
    expect(body).toBeTruthy();
    // chrome（底色/圆角/边框/阴影）由外层 .cm-tooltip 承载：内层只留布局类，透明无圆角
    expect(dom.className).toContain('neeko-diagnostic-popup');
    expect(dom.className).not.toContain('rounded-md');
    expect(dom.className).not.toContain('bg-[');
    // 长消息换行完整展示（VS Code 不省略），不做 truncate
    expect(head?.className).toContain('break-words');
    expect(head?.className).not.toContain('truncate');
  });

  it('动作行单行不换行（VS Code 形态），三个入口各就各位', () => {
    const body = document.createElement('div');
    const view = makeView();
    appendShortcutRow(body, CTX, view, DOC.indexOf('fmt') + 1);

    const actions = body.querySelector('[data-testid="editor-diagnostic-popup-actions"]');
    expect(actions).toBeTruthy();
    expect(actions?.className).toContain('flex');
    expect(actions?.className).not.toContain('flex-wrap');
    expect(actions?.className).toContain('whitespace-nowrap');
    expect(body.textContent).toContain('View Problem (F2)');
    expect(body.textContent).toContain('Quick Fix… (⌥Enter)');
    // AI 入口：lucide Sparkles 图标 + Fix (⌘I)（不用 ✨ 字符）
    expect(body.textContent).toContain('Fix (⌘I)');
    expect(body.textContent).not.toContain('✨');
    // 图标与文字垂直居中对齐、gap 拉开间距；图标缩到与 10.5px 文字匹配的 10px
    const sparklesBtn = [...body.querySelectorAll('button')].find((b) =>
      b.querySelector('svg.lucide-sparkles'),
    );
    expect(sparklesBtn).toBeTruthy();
    expect(sparklesBtn?.className).toContain('items-center');
    expect(sparklesBtn?.className).toContain('gap-1');
    expect(sparklesBtn?.querySelector('svg')?.getAttribute('width')).toBe('10');
    view.destroy();
  });

  it('shortcutHint：fix 提示 Mod-I（AI Fix），不再指向服务器首选的 ⌘.', () => {
    expect(shortcutHint('fix')).toBe('⌘I');
    // 其余键位提示不受影响
    expect(shortcutHint('quickFix')).toBe('⌥Enter');
    expect(shortcutHint('viewProblem')).toBe('F2');
  });
});
