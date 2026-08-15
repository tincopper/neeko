import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * 注入脚本（picker_script.js）行为测试。
 *
 * 该脚本由 Rust 以 include_str! 注入浏览器 webview，无法直接 import。
 * 这里在 jsdom 中读取原始文件、注入 window.__NEEKO_THEME__ 后执行，
 * 验证：单选锁定/发送、多选 chips 内嵌 Composer（无独立托盘）、
 * 单颗药丸开关切模式（携带/提升元素）、payload 结构、Esc 取消。
 */

const SCRIPT_PATH = 'src-tauri/src/browser/picker_script.js';
let scriptSource = '';
let notified: Array<{
  type: string;
  prompt?: string;
  elements?: Array<{ html: string; selector: string }>;
}> = [];

beforeAll(() => {
  scriptSource = readFileSync(SCRIPT_PATH, 'utf8');

  // fetch 桩：记录 neeko:// POST 消息
  vi.stubGlobal('fetch', (url: string, opts: { body: string }) => {
    const body = JSON.parse(opts.body) as { type: string; prompt?: string; elements?: unknown };
    notified.push({
      type: body.type,
      prompt: body.prompt,
      elements: body.elements as never,
    });
    return Promise.resolve({ ok: true });
  });

  // 注入脚本所需全局
  (globalThis as Record<string, unknown>).__NEEKO_THEME__ = {
    bgSecondary: '#181A1C',
    bgTertiary: '#333337',
    textPrimary: '#fff',
    textMuted: '#999',
    borderColor: '#3b3b40',
    accentBlue: '#2997ff',
  };
  (globalThis as Record<string, unknown>).__NEEKO_NOTIFY_BASE__ = 'http://neeko.localhost/';
  // jsdom 无 rAF → 同步执行回调，保证断言可确定
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('picker_script.js (injected element picker)', () => {
  it('single mode: pick → lock → 1 chip → composer → send', async () => {
    notified = [];
    document.body.innerHTML = `
      <div id="app">
        <button id="navCta">Get Started</button>
        <div class="card"><h3>Card</h3><p>desc</p></div>
      </div>
    `;
    // 执行注入脚本（每次重建干净实例）
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(scriptSource).call(window);

    const navBtn = document.getElementById('navCta')!;
    const clickEl = (el: Element) =>
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }),
      );

    // 单选：点击锁定 + Composer 打开 + 1 个 chip
    clickEl(navBtn);
    expect(navBtn.classList.contains('neeko-selected')).toBe(true);
    const ccInput = document.querySelector<HTMLTextAreaElement>('.neeko-ui-root textarea');
    expect(ccInput).not.toBeNull();
    expect(ccInput!.closest('div')!.style.display).toBe('flex');
    const chips = () => document.querySelectorAll('.neeko-ui-root .cc-chip').length;
    expect(chips()).toBe(1);
    expect(document.querySelector('.neeko-ui-root .cc-chip')!.textContent).toContain('navCta');
    // 注入类（neeko-selected）不得泄漏进 chip 显示的 selector
    expect(document.querySelector('.neeko-ui-root .cc-chip')!.textContent).not.toContain(
      'neeko-selected',
    );

    // 聚焦/失焦 → 通知 Rust（macOS 菜单 Edit 命令据此转发到浏览器 webview）
    ccInput!.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(notified.some((n) => n.type === 'picker-focused')).toBe(true);
    ccInput!.dispatchEvent(new Event('focusout', { bubbles: true }));
    expect(notified.some((n) => n.type === 'picker-blurred')).toBe(true);

    // 输入后发送按钮启用，点击发送
    ccInput!.value = 'make it red';
    ccInput!.dispatchEvent(new Event('input', { bubbles: true }));
    const sendBtn = [...document.querySelectorAll('.neeko-ui-root button')].find((b) =>
      b.textContent!.includes('Send'),
    ) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);

    sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));

    // 聚焦/发送等消息混在 notified 里，按 type 过滤到目标消息再断言
    const submitted = notified.filter((n) => n.type === 'prompt-submitted');
    expect(submitted).toHaveLength(1);
    expect(submitted[0].elements).toHaveLength(1);
    expect(submitted[0].elements![0].html).toContain('navCta');
    expect(submitted[0].elements![0].selector).toBe('button#navCta');
    // 发送给 Agent 的 HTML 与 selector 不得含注入类
    expect(submitted[0].elements![0].html).not.toContain('neeko-selected');
    expect(submitted[0].elements![0].selector).not.toContain('neeko-selected');
    expect(navBtn.classList.contains('neeko-selected')).toBe(false); // 发送后立即清理
    expect(chips()).toBe(0);

    // 清理本次实例
    (window as unknown as { __NEEKO_PICKER__?: { stop(): void } }).__NEEKO_PICKER__?.stop();
  });

  it('multi mode: pill switch carries element, chips accumulate inline, send all', async () => {
    notified = [];
    document.body.innerHTML = `
      <div id="app">
        <button id="navCta">Get Started</button>
        <div class="card"><h3>Card</h3><p>desc</p></div>
      </div>
    `;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(scriptSource).call(window);

    const navBtn = document.getElementById('navCta')!;
    const card = document.querySelector('.card')!;
    const clickEl = (el: Element) =>
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }),
      );
    const chips = () => document.querySelectorAll('.neeko-ui-root .cc-chip').length;
    const ccInput = document.querySelector<HTMLTextAreaElement>('.neeko-ui-root textarea')!;

    // 默认单选：点击第一个元素 → 锁定 + Composer 打开 + 1 chip
    clickEl(navBtn);
    expect(ccInput.closest('div')!.style.display).toBe('flex');
    expect(chips()).toBe(1);

    // 药丸开关切到 Multi（携带当前元素为第 1 个）
    const modeSwitch = [...document.querySelectorAll('.neeko-ui-root button')].find(
      (b) => b.textContent!.includes('Single') || b.textContent!.includes('Multi'),
    ) as HTMLButtonElement;
    expect(modeSwitch).toBeDefined();
    modeSwitch.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
    expect(modeSwitch.textContent).toContain('Multi');
    expect(ccInput.closest('div')!.style.display).toBe('flex'); // Composer 保持打开
    expect(chips()).toBe(1); // 元素被携带
    expect(navBtn.classList.contains('neeko-selected')).toBe(true);

    // 继续累加第二个 → 2 chips 实时更新，输入不丢
    ccInput.value = 'make bigger';
    ccInput.dispatchEvent(new Event('input', { bubbles: true }));
    clickEl(card);
    await new Promise((r) => setTimeout(r, 10));
    expect(chips()).toBe(2);
    expect(ccInput.value).toBe('make bigger'); // 累加不丢已输入内容
    expect(card.classList.contains('neeko-selected')).toBe(true);

    // 发送 → 两个元素全部入 payload
    const sendBtn = [...document.querySelectorAll('.neeko-ui-root button')].find((b) =>
      b.textContent!.includes('Send'),
    ) as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));

    const submitted = notified.filter((n) => n.type === 'prompt-submitted');
    expect(submitted).toHaveLength(1);
    expect(submitted[0].elements).toHaveLength(2);
    expect(submitted[0].elements![0].selector).toBe('button#navCta');
    expect(submitted[0].elements![1].selector).toBe('div.card');
    expect(navBtn.classList.contains('neeko-selected')).toBe(false);
    expect(card.classList.contains('neeko-selected')).toBe(false);
    expect(chips()).toBe(0);

    (window as unknown as { __NEEKO_PICKER__?: { stop(): void } }).__NEEKO_PICKER__?.stop();
  });

  it('refine (Parent/Child) keeps composer open and syncs chip', async () => {
    notified = [];
    document.body.innerHTML = `
      <div id="app">
        <div id="wrap"><button id="navCta">Get Started</button></div>
        <div class="card"><h3>Card</h3><p>desc</p></div>
      </div>
    `;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(scriptSource).call(window);

    const navBtn = document.getElementById('navCta')!;
    const wrap = document.getElementById('wrap')!;
    const clickEl = (el: Element) =>
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }),
      );
    const chips = () => document.querySelectorAll('.neeko-ui-root .cc-chip').length;
    const ccInput = document.querySelector<HTMLTextAreaElement>('.neeko-ui-root textarea')!;

    // 单选锁定 navCta，输入 prompt
    clickEl(navBtn);
    expect(ccInput.closest('div')!.style.display).toBe('flex');
    expect(chips()).toBe(1);
    ccInput.value = 'make bigger';
    ccInput.dispatchEvent(new Event('input', { bubbles: true }));

    // 点 Parent → 锁定切换为父级，chip 同步，Composer 保持打开，输入不丢
    const sbUp = [...document.querySelectorAll('.neeko-ui-root button')].find((b) =>
      b.textContent!.includes('Parent'),
    ) as HTMLButtonElement;
    sbUp.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));

    expect(wrap.classList.contains('neeko-selected')).toBe(true);
    expect(navBtn.classList.contains('neeko-selected')).toBe(false);
    expect(chips()).toBe(1);
    expect(document.querySelector('.neeko-ui-root .cc-chip')!.textContent).toContain('wrap');
    expect(ccInput.closest('div')!.style.display).toBe('flex'); // Composer 保持打开
    expect(ccInput.value).toBe('make bigger'); // 输入不丢

    // 发送 → payload 反映的是 refine 后的元素
    const sendBtn = [...document.querySelectorAll('.neeko-ui-root button')].find((b) =>
      b.textContent!.includes('Send'),
    ) as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    const submitted = notified.filter((n) => n.type === 'prompt-submitted');
    expect(submitted[0].elements).toHaveLength(1);
    expect(submitted[0].elements![0].selector).toBe('div#wrap');

    (window as unknown as { __NEEKO_PICKER__?: { stop(): void } }).__NEEKO_PICKER__?.stop();
  });

  it('keeps odd class names (constructor) and drops injected ones from selector', async () => {
    notified = [];
    document.body.innerHTML = '<div id="app"><button id="b" class="constructor">x</button></div>';
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(scriptSource).call(window);

    const b = document.getElementById('b')!;
    b.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }),
    );
    const chip = document.querySelector('.neeko-ui-root .cc-chip')!;
    // 'constructor' 不得因对象集合原型链被误过滤
    expect(chip.textContent).toContain('constructor');
    expect(chip.textContent).not.toContain('neeko-selected');

    (window as unknown as { __NEEKO_PICKER__?: { stop(): void } }).__NEEKO_PICKER__?.stop();
  });

  it('notifies picker-cancelled on Escape', async () => {
    notified = [];
    document.body.innerHTML = '<div id="app"><button id="b">x</button></div>';
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(scriptSource).call(window);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(notified.some((n) => n.type === 'picker-cancelled')).toBe(true);
  });
});
