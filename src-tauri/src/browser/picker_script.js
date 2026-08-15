//! Picker 注入脚本(浏览器元素选择器)。
//!
//! 由 `src-tauri/src/browser/commands.rs` 的 `include_str!("picker_script.js")` 消费,
//! 随 `browser_start_picker` 命令注入浏览器 webview。
//!
//! 脚本通过 `window.__NEEKO_THEME__`(主题色)与 `window.__NEEKO_NOTIFY_BASE__`
//! (neeko:// 协议 base)配置,经 `fetch POST` 向 Rust 回传 picker 消息。
//!
//! 能力：单选/多选双模式；hover 高亮(rAF 节流)；点击锁定(角标+操作条)；
//! 底部 AI Composer——多选元素以 chips 内嵌显示在输入区上方(无独立托盘)，
//! 模式用单颗「⇄ Single/Multi」药丸开关(位于发送按钮左侧)切换，顶部 Pill 仅被动指示。
//! Esc/✕ 语义；滚动跟随。消息体：`prompt-submitted` 携带 `elements: [{ html, selector }]`。
//!
//! 修改本文件后无需重启 Rust 编译缓存——include_str! 会跟踪文件变更。
(function () {
  'use strict';
  if (window.__NEEKO_PICKER__) return;

  /* ---- theme ---- */
  var T = window.__NEEKO_THEME__ || {};
  var C = {
    bg:      T.bgSecondary  || 'rgba(24,24,27,.92)',
    bgHover: T.bgTertiary   || '#2d2e32',
    text:    T.textPrimary  || '#fff',
    muted:   T.textMuted    || '#666',
    border:  T.borderColor  || 'rgba(255,255,255,.15)',
    accent:  T.accentBlue   || '#61afef'
  };
  var ACCENT_RGB = (function () {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(C.accent);
    return m
      ? parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16)
      : '97,175,239';
  })();
  var FONT = '13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif';
  var UI_CLS = 'neeko-ui-root';

  function isUIEl(el) {
    return !!(el && el.closest && el.closest('.' + UI_CLS));
  }
  function makeEl(tag, cssText) {
    var el = document.createElement(tag);
    if (cssText) el.style.cssText = cssText;
    return el;
  }
  function getSelector(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string' && el.className.trim()) {
      // 显式比较（勿用对象做集合：'constructor' 等类名会命中原型链成员被误过滤）
      var cls = el.className.trim().split(/\s+/).filter(function (c) {
        return c !== 'neeko-selected' && c !== 'neeko-hover';
      });
      if (cls.length) s += '.' + cls.slice(0, 2).join('.');
    }
    return s;
  }
  /* 临时摘掉注入类后抓 outerHTML，再还原，保证输出干净 */
  function cleanOuterHTML(el) {
    var hadSel = el.classList.contains('neeko-selected');
    var hadHover = el.classList.contains('neeko-hover');
    if (hadSel) el.classList.remove('neeko-selected');
    if (hadHover) el.classList.remove('neeko-hover');
    var html = el.outerHTML;
    if (hadSel) el.classList.add('neeko-selected');
    if (hadHover) el.classList.add('neeko-hover');
    return html;
  }
  function getSize(el) {
    var r = el.getBoundingClientRect();
    return Math.round(r.width) + '\u00d7' + Math.round(r.height);
  }
  function isPinnable(el) {
    if (!el) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (isUIEl(el)) return false;
    return true;
  }
  function notify(type, data) {
    try {
      var base = window.__NEEKO_NOTIFY_BASE__ || 'http://neeko.localhost/';
      fetch(base + type, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ type: type }, data || {}))
      }).catch(function () {});
    } catch (ex) {}
  }

  /* ---- 注入高亮样式与动画（!important 保证不被页面样式覆盖） ---- */
  var styleEl = makeEl('style');
  styleEl.textContent =
    '.neeko-hover{outline:2px dashed ' + C.accent + '!important;outline-offset:2px!important;' +
    'box-shadow:0 0 0 4px rgba(' + ACCENT_RGB + ',.16),0 0 18px rgba(' + ACCENT_RGB + ',.28)!important;' +
    'transition:none!important;}' +
    '.neeko-selected{outline:2px solid ' + C.accent + '!important;outline-offset:2px!important;' +
    'box-shadow:0 0 0 3px rgba(' + ACCENT_RGB + ',.32),0 0 22px rgba(' + ACCENT_RGB + ',.35)!important;' +
    'transition:none!important;}' +
    '@keyframes neeko-pulse{0%,100%{opacity:1}50%{opacity:.35}}' +
    '@keyframes neeko-msL{from{transform:translateX(-8px);opacity:0}to{transform:translateX(0);opacity:1}}' +
    '@keyframes neeko-msR{from{transform:translateX(8px);opacity:0}to{transform:translateX(0);opacity:1}}' +
    '.neeko-ms-to-multi{animation:neeko-msL .18s ease-out}' +
    '.neeko-ms-to-single{animation:neeko-msR .18s ease-out}';
  document.documentElement.appendChild(styleEl);

  /* ---- 状态 ---- */
  var S = {
    mode: 'single',          // 'single' | 'multi'
    hoverEl: null,
    selectedEl: null,        // 单选锁定元素
    multiSel: [],            // 多选数组（保序）
    mouseX: 0, mouseY: 0,
    rAF: 0,
    oldCursor: '',
  };

  /* ---- 覆盖层根（pointer-events:none，交互子节点单独开启） ---- */
  var uiRoot = makeEl('div',
    'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;' +
    'pointer-events:none;font:' + FONT + ';color:' + C.text + ';line-height:1.4;'
  );
  uiRoot.className = UI_CLS;
  document.documentElement.appendChild(uiRoot);

  /* =================== 顶部模式 Pill（纯被动指示） =================== */
  var pill = makeEl('div',
    'position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;' +
    'gap:9px;padding:6px 12px;border-radius:999px;background:' + C.bg + ';' +
    'border:1px solid rgba(' + ACCENT_RGB + ',.45);box-shadow:0 12px 40px rgba(0,0,0,.45);' +
    'color:' + C.text + ';font:600 12px/1.4 system-ui,sans-serif;user-select:none;' +
    'pointer-events:none;white-space:nowrap;'
  );
  var pillDot = makeEl('span',
    'width:8px;height:8px;border-radius:50%;background:' + C.accent + ';flex-shrink:0;' +
    'animation:neeko-pulse 1.2s ease-in-out infinite;'
  );
  pill.appendChild(pillDot);
  var pillText = makeEl('span', 'white-space:nowrap;');
  pill.appendChild(pillText);
  uiRoot.appendChild(pill);

  function updateModeText() {
    pillText.textContent = S.mode === 'single'
      ? 'Click to pick \u00b7 Esc to exit'
      : 'Click to add \u00b7 click again to cancel \u00b7 Esc to exit';
  }

  /* =================== Tooltip Chip =================== */
  var tip = makeEl('div',
    'position:fixed;display:none;align-items:center;gap:7px;padding:4px 9px;border-radius:7px;' +
    'background:' + C.bg + ';border:1px solid ' + C.border + ';box-shadow:0 1px 3px rgba(0,0,0,.3);' +
    'font:600 12px/1.5 system-ui,sans-serif;color:' + C.text + ';white-space:nowrap;' +
    'max-width:60vw;overflow:hidden;'
  );
  var tipTag = makeEl('span', 'color:' + C.accent + ';font-weight:800;');
  var tipSel = makeEl('span', 'color:' + C.text + ';font-weight:500;overflow:hidden;text-overflow:ellipsis;');
  var tipSize = makeEl('span', 'color:' + C.muted + ';font-weight:400;');
  var tipHint = makeEl('span', 'color:' + C.muted + ';font-weight:400;');
  tip.appendChild(tipTag);
  tip.appendChild(tipSel);
  tip.appendChild(tipSize);
  tip.appendChild(tipHint);
  uiRoot.appendChild(tip);

  function positionTip() {
    var r = tip.getBoundingClientRect();
    var x = S.mouseX + 14, y = S.mouseY + 18;
    if (x + r.width > window.innerWidth - 8) x = S.mouseX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = S.mouseY - r.height - 14;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function showTip(el) {
    tipTag.textContent = el.tagName.toLowerCase();
    tipSel.textContent = getSelector(el);
    tipSize.textContent = '\u00b7 ' + getSize(el);
    tipHint.textContent = '\u00b7 ' + (S.mode === 'single' ? 'Click to pick'
      : (S.multiSel.indexOf(el) >= 0 ? 'Click to cancel' : 'Click to add'));
    tip.style.display = 'flex';
    positionTip();
  }
  function hideTip() { tip.style.display = 'none'; }

  /* =================== 高亮 =================== */
  function clearHover() {
    if (S.hoverEl) { S.hoverEl.classList.remove('neeko-hover'); S.hoverEl = null; }
  }
  function onMove(e) {
    S.mouseX = e.clientX;
    S.mouseY = e.clientY;
    if (S.rAF) return;
    S.rAF = requestAnimationFrame(function () {
      S.rAF = 0;
      var t = e.target;
      if (!t || !isPinnable(t) || t === S.selectedEl || S.multiSel.indexOf(t) >= 0) {
        if (t === S.selectedEl || S.multiSel.indexOf(t) >= 0) { hideTip(); return; }
        clearHover(); hideTip(); return;
      }
      if (t !== S.hoverEl) { clearHover(); S.hoverEl = t; }
      t.classList.add('neeko-hover');
      showTip(t);
      positionTip();
    });
  }

  /* =================== 徽标 =================== */
  var badges = [];
  function makeBadge(text, extraCss) {
    var b = makeEl('div',
      'position:fixed;pointer-events:none;display:flex;align-items:center;gap:5px;' +
      'background:' + C.accent + ';color:#fff;border-radius:4px;' +
      'font:600 10.5px/1.5 system-ui,sans-serif;padding:2px 7px;box-shadow:0 1px 3px rgba(0,0,0,.3);' +
      'white-space:nowrap;z-index:2147483646;' + (extraCss || '')
    );
    b.textContent = text;
    uiRoot.appendChild(b);
    badges.push(b);
    return b;
  }
  function removeBadges() {
    badges.forEach(function (b) { b.remove(); });
    badges = [];
  }
  /* 单选：四角徽标 */
  function updateCornerBadges(el) {
    removeBadges();
    if (!el) return;
    var r = el.getBoundingClientRect();
    var tl = makeBadge(el.tagName.toLowerCase() + (el.id ? ' #' + el.id : ''));
    var br = makeBadge(Math.round(r.width) + '\u00d7' + Math.round(r.height), 'font-weight:400;opacity:.9;');
    tl.style.left = (r.left - 2) + 'px';
    tl.style.top = (r.top - 2 - 22) + 'px';
    br.style.left = (r.right - 2 - br.offsetWidth) + 'px';
    br.style.top = (r.bottom + 4) + 'px';
  }
  /* 多选：编号徽标 */
  function renderNumBadges() {
    removeBadges();
    S.multiSel.forEach(function (el, i) {
      var r = el.getBoundingClientRect();
      var b = makeBadge(String(i + 1), 'min-width:18px;justify-content:center;font-weight:800;font-size:11px;border-radius:5px;padding:1px 6px;');
      b.style.left = (r.left - 2) + 'px';
      b.style.top = (r.top - 2) + 'px';
    });
  }

  /* =================== 单选：操作条 =================== */
  var selBar = makeEl('div',
    'position:fixed;display:none;gap:4px;padding:4px;border-radius:8px;' +
    'background:' + C.bg + ';border:1px solid ' + C.border + ';box-shadow:0 12px 40px rgba(0,0,0,.45);' +
    'pointer-events:auto;z-index:2147483646;'
  );
  function makeSbBtn(label, onClick) {
    var b = makeEl('button',
      'border:none;border-radius:6px;padding:5px 9px;background:transparent;color:' + C.muted + ';' +
      'font:500 12px/1.4 system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:4px;'
    );
    b.textContent = label;
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    b.addEventListener('mouseenter', function () { b.style.background = C.bgHover; b.style.color = C.text; });
    b.addEventListener('mouseleave', function () { b.style.background = 'transparent'; b.style.color = C.muted; });
    return b;
  }
  var sbUp = makeSbBtn('\u2196 Parent', function () { refine('up'); });    // ↖ Parent
  var sbDown = makeSbBtn('\u2198 Child', function () { refine('down'); });  // ↘ Child
  var sbCopy = makeSbBtn('\u29c9 Copy HTML', copySelected);                // ⧉ Copy HTML
  selBar.appendChild(sbUp);
  selBar.appendChild(sbDown);
  selBar.appendChild(sbCopy);
  uiRoot.appendChild(selBar);

  function positionSelBar(el) {
    var r = el.getBoundingClientRect();
    var x = r.left, y = r.bottom + 8;
    if (y + selBar.offsetHeight > window.innerHeight - 8) y = r.top - selBar.offsetHeight - 8;
    if (x + selBar.offsetWidth > window.innerWidth - 8) x = window.innerWidth - selBar.offsetWidth - 8;
    selBar.style.left = x + 'px';
    selBar.style.top = y + 'px';
    selBar.style.display = 'flex';
  }
  function applySelection(el) {
    clearHover(); hideTip();
    S.selectedEl = el;
    el.classList.add('neeko-selected');
    updateCornerBadges(el);
    positionSelBar(el);
    sbUp.style.opacity = isPinnable(el.parentElement) ? '1' : '.35';
    sbDown.style.opacity = el.firstElementChild ? '1' : '.35';
    renderChips();
  }
  function lockSelection(el) {
    clearSelected();
    applySelection(el);
  }
  function refine(direction) {
    if (!S.selectedEl) return;
    var next = direction === 'up' ? S.selectedEl.parentElement : S.selectedEl.firstElementChild;
    if (!next || !isPinnable(next)) return;
    // 切换锁定元素：保持 Composer 打开并同步 chip（不丢已输入内容）
    S.selectedEl.classList.remove('neeko-selected');
    applySelection(next);
  }
  function copySelected() {
    if (!S.selectedEl) return;
    notify('element-picked', { html: cleanOuterHTML(S.selectedEl) });
    flashSuccess('Copied element HTML to clipboard');
  }

  /* =================== 多选（chips 内嵌 Composer，无独立托盘） =================== */
  function currentElements() {
    if (S.mode === 'single') return S.selectedEl ? [S.selectedEl] : [];
    return S.multiSel.slice();
  }
  function toggleMulti(el) {
    var idx = S.multiSel.indexOf(el);
    if (idx >= 0) {
      S.multiSel.splice(idx, 1);
      el.classList.remove('neeko-selected');
      renderNumBadges();
    } else {
      S.multiSel.push(el);
      el.classList.add('neeko-selected');
      renderNumBadges();
    }
    renderChips();
    if (S.multiSel.length === 0) closeComposer();
  }
  function clearMulti() {
    S.multiSel.forEach(function (el) { el.classList.remove('neeko-selected'); });
    S.multiSel = [];
    removeBadges();
    renderChips();
  }
  function clearSingle() {
    if (S.selectedEl) { S.selectedEl.classList.remove('neeko-selected'); S.selectedEl = null; }
    removeBadges();
    selBar.style.display = 'none';
    renderChips();
  }
  function clearSelected() {
    clearSingle();
    clearMulti();
    closeComposer();
  }

  /* =================== AI Composer =================== */
  var composer = makeEl('div',
    'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);display:none;flex-direction:column;' +
    'gap:10px;padding:12px 12px 10px;width:min(560px,calc(100vw - 32px));border-radius:14px;' +
    'background:' + C.bg + ';border:1px solid rgba(' + ACCENT_RGB + ',.35);' +
    'box-shadow:0 12px 40px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.05);' +
    'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);pointer-events:auto;z-index:2147483647;'
  );

  /* 顶部：选中元素 chips 行 + 关闭按钮 */
  var ccHead = makeEl('div', 'display:flex;align-items:flex-start;gap:8px;');
  var ccChips = makeEl('div',
    'flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:6px;max-height:96px;overflow-y:auto;'
  );
  var ccClose = makeEl('button',
    'flex-shrink:0;width:24px;height:24px;border:none;border-radius:6px;background:transparent;' +
    'color:' + C.muted + ';cursor:pointer;font-size:15px;line-height:1;'
  );
  ccClose.textContent = '\u2715';
  ccClose.addEventListener('mouseenter', function () { ccClose.style.background = C.bgHover; ccClose.style.color = C.text; });
  ccClose.addEventListener('mouseleave', function () { ccClose.style.background = 'transparent'; ccClose.style.color = C.muted; });
  ccHead.appendChild(ccChips);
  ccHead.appendChild(ccClose);

  var ccInput = makeEl('textarea',
    'all:initial;width:100%;min-height:40px;max-height:150px;resize:none;overflow-y:auto;' +
    'padding:4px 2px;border:none;outline:none;background:transparent;color:' + C.text + ';' +
    'font:14px/1.6 system-ui,-apple-system,sans-serif;display:block;box-sizing:border-box;'
  );
  ccInput.placeholder = 'Describe how to modify these elements\u2026';
  ccInput.rows = 1;

  /* 底部：提示 + 模式药丸开关 + 发送 */
  var ccFoot = makeEl('div', 'display:flex;align-items:center;gap:8px;');
  var ccHint = makeEl('span',
    'flex:1;color:' + C.muted + ';font:400 11px/1.5 system-ui,sans-serif;white-space:nowrap;' +
    'overflow:hidden;text-overflow:ellipsis;'
  );
  ccHint.innerHTML = '<kbd style="font-family:inherit;font-size:10.5px;padding:1px 5px;border-radius:4px;' +
    'background:' + C.bgHover + ';border:1px solid ' + C.border + ';color:' + C.muted + ';">Enter</kbd>' +
    ' send \u00b7 <kbd style="font-family:inherit;font-size:10.5px;padding:1px 5px;border-radius:4px;' +
    'background:' + C.bgHover + ';border:1px solid ' + C.border + ';color:' + C.muted + ';">Shift+Enter</kbd>' +
    ' newline \u00b7 <kbd style="font-family:inherit;font-size:10.5px;padding:1px 5px;border-radius:4px;' +
    'background:' + C.bgHover + ';border:1px solid ' + C.border + ';color:' + C.muted + ';">Esc</kbd> cancel';
  var modeSwitch = makeEl('button',
    'flex-shrink:0;display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(' + ACCENT_RGB + ',.4);' +
    'border-radius:999px;padding:5px 11px;background:' + C.bgHover + ';color:' + C.text + ';' +
    'font:600 11.5px/1.4 system-ui,sans-serif;cursor:pointer;'
  );
  modeSwitch.title = 'Toggle: Single \u21c4 Multi';
  var msIco = makeEl('span', 'color:' + C.accent + ';font-size:11px;line-height:1;');
  msIco.textContent = '\u21c4'; // ⇄
  var msLabel = makeEl('span', 'display:inline-block;min-width:26px;text-align:center;');
  modeSwitch.appendChild(msIco);
  modeSwitch.appendChild(msLabel);
  modeSwitch.addEventListener('click', function (e) {
    e.stopPropagation();
    setMode(S.mode === 'single' ? 'multi' : 'single');
  });

  var ccSend = makeEl('button',
    'flex-shrink:0;display:inline-flex;align-items:center;gap:6px;border:none;border-radius:8px;' +
    'padding:7px 14px;background:' + C.accent + ';color:#fff;font:600 12.5px/1.4 system-ui,sans-serif;' +
    'cursor:pointer;opacity:.45;'
  );
  ccSend.innerHTML = '<span>Send</span>' +
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';
  ccSend.disabled = true;
  ccFoot.appendChild(ccHint);
  ccFoot.appendChild(modeSwitch);
  ccFoot.appendChild(ccSend);

  composer.appendChild(ccHead);
  composer.appendChild(ccInput);
  composer.appendChild(ccFoot);
  uiRoot.appendChild(composer);

  /* =================== 模式药丸开关渲染 =================== */
  function renderModeSwitch() {
    var single = S.mode === 'single';
    msLabel.textContent = single ? 'Single' : 'Multi';
    msLabel.classList.remove('neeko-ms-to-multi', 'neeko-ms-to-single');
    void msLabel.offsetWidth; // 重启动画
    msLabel.classList.add(single ? 'neeko-ms-to-single' : 'neeko-ms-to-multi');
  }

  /* =================== Composer 行为 =================== */
  function setSendEnabled(enabled) {
    ccSend.disabled = !enabled;
    ccSend.style.opacity = enabled ? '1' : '.45';
    ccSend.style.cursor = enabled ? 'pointer' : 'default';
  }
  ccSend.addEventListener('click', function (e) {
    e.stopPropagation();
    sendPrompt();
  });
  ccInput.addEventListener('input', function () {
    autoGrow();
    setSendEnabled(ccInput.value.trim().length > 0);
  });
  ccInput.addEventListener('keydown', function (e) {
    // 阻止事件冒泡到页面/其他 handler，回车处理统一走 document 的 onKey
    e.stopPropagation();
  });
  // 聚焦/失焦 → 通知 Rust（macOS 菜单 Edit 命令据此转发到本浏览器 webview，
  // 否则 Cmd+C/V/A 被菜单加速键在 OS 层截获、永远到不了这个输入框）
  ccInput.addEventListener('focusin', function () { notify('picker-focused'); });
  ccInput.addEventListener('focusout', function () { notify('picker-blurred'); });
  composer.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  selBar.addEventListener('mousedown', function (e) { e.stopPropagation(); });

  function autoGrow() {
    ccInput.style.height = 'auto';
    var h = Math.min(ccInput.scrollHeight, 150);
    ccInput.style.height = h + 'px';
    ccInput.style.overflowY = ccInput.scrollHeight > 150 ? 'auto' : 'hidden';
  }
  // 在输入区上方渲染选中元素 chips（单选 1 个 / 多选 N 个）
  function renderChips() {
    ccChips.innerHTML = '';
    var els = currentElements();
    els.forEach(function (el, i) {
      var chip = makeEl('div',
        'display:flex;align-items:center;gap:6px;padding:3px 6px 3px 3px;border-radius:7px;' +
        'background:rgba(' + ACCENT_RGB + ',.10);border:1px solid rgba(' + ACCENT_RGB + ',.25);'
      );
      chip.className = 'cc-chip';
      var num = makeEl('span',
        'width:18px;height:18px;border-radius:5px;background:' + C.accent + ';color:#fff;' +
        'font:800 11px/18px system-ui,sans-serif;text-align:center;flex-shrink:0;'
      );
      num.textContent = String(i + 1);
      var sel = makeEl('span', 'font:600 11.5px/1.5 system-ui,sans-serif;color:' + C.text + ';');
      sel.textContent = getSelector(el);
      var dim = makeEl('span', 'font:400 11px/1.5 system-ui,sans-serif;color:' + C.muted + ';');
      dim.textContent = getSize(el);
      var x = makeEl('button',
        'border:none;background:transparent;color:' + C.muted + ';cursor:pointer;font-size:12px;' +
        'padding:2px;border-radius:4px;line-height:1;'
      );
      x.textContent = '\u2715';
      x.title = 'Remove';
      x.addEventListener('click', function (ev) {
        ev.stopPropagation();
        removeChip(i);
      });
      x.addEventListener('mouseenter', function () { x.style.color = '#f16a6a'; x.style.background = C.bgHover; });
      x.addEventListener('mouseleave', function () { x.style.color = C.muted; x.style.background = 'transparent'; });
      chip.appendChild(num);
      chip.appendChild(sel);
      chip.appendChild(dim);
      chip.appendChild(x);
      ccChips.appendChild(chip);
    });
    ccClose.title = S.mode === 'multi' && els.length > 0
      ? 'Clear selection & close'
      : 'Close (back to picking)';
  }
  function removeChip(i) {
    if (S.mode === 'single') { clearSingle(); closeComposer(); return; }
    var el = S.multiSel[i];
    if (el) {
      S.multiSel.splice(i, 1);
      el.classList.remove('neeko-selected');
      renderNumBadges();
      renderChips();
    }
    if (S.multiSel.length === 0) closeComposer();
  }
  function openComposer() {
    if (S.mode === 'single' && !S.selectedEl) return;
    if (S.mode === 'multi' && S.multiSel.length === 0) return;
    var first = composer.style.display !== 'flex';
    renderChips();
    if (first) {
      ccInput.value = '';
      setSendEnabled(false);
      composer.style.display = 'flex';
      setTimeout(function () { ccInput.focus(); autoGrow(); }, 0);
    }
  }
  function closeComposer() {
    composer.style.display = 'none';
  }
  function sendPrompt() {
    var text = ccInput.value.trim();
    if (!text) return;
    var els = S.mode === 'single' ? [S.selectedEl] : S.multiSel.slice();
    composer.style.display = 'none';
    // 立即清理选中态（不用延迟清理，避免清掉发送后的新一轮选择）
    if (S.mode === 'single') clearSingle(); else clearMulti();
    notify('prompt-submitted', {
      prompt: text,
      elements: els.map(function (el) {
        // 发送前已清类，此处 cleanOuterHTML 为显式兜底，确保 HTML 无注入类
        return { html: cleanOuterHTML(el), selector: getSelector(el) };
      })
    });
    flashSuccess('Sent to Agent: ' + els.length + ' element' + (els.length > 1 ? 's' : ''));
    // 发送后继续停留在选择模式（页面刷新时由前端 reinject 重建）
  }

  /* =================== 模式切换 =================== */
  function setMode(m) {
    if (S.mode === m) return;
    var prev = S.mode;
    S.mode = m;
    renderModeSwitch();
    var prompt = ccInput.value;

    if (prev === 'single' && m === 'multi') {
      // 单→多：把当前锁定元素带入多选（第 1 个），Composer 保持打开显示，可继续累加
      if (S.selectedEl && S.multiSel.indexOf(S.selectedEl) < 0) S.multiSel.push(S.selectedEl);
      clearSingle();
      S.multiSel.forEach(function (el) { el.classList.add('neeko-selected'); });
      renderNumBadges();
      flashSuccess('Switched to Multi \u2014 click to keep adding');
    } else if (prev === 'multi' && m === 'single') {
      // 多→单：保留最后一个选中元素为单选锁定
      if (S.multiSel.length > 0) {
        var last = S.multiSel[S.multiSel.length - 1];
        clearMulti();
        lockSelection(last);
      } else {
        clearMulti();
      }
      flashSuccess('Switched to Single \u2014 click to lock');
    } else {
      clearSelected();
      flashSuccess(m === 'multi' ? 'Switched to Multi mode' : 'Switched to Single mode');
    }

    renderChips();
    // Composer 保持/重新打开（不丢已输入内容）
    if (S.mode === 'single' ? S.selectedEl : S.multiSel.length > 0) {
      if (composer.style.display !== 'flex') {
        composer.style.display = 'flex';
        setTimeout(function () { ccInput.focus(); autoGrow(); }, 0);
      }
      ccInput.value = prompt;
      setSendEnabled(prompt.trim().length > 0);
    } else {
      closeComposer();
    }
    updateModeText();
  }

  /* =================== 成功反馈 =================== */
  var successPill = makeEl('div',
    'position:fixed;top:14px;left:50%;transform:translateX(-50%);display:none;align-items:center;' +
    'gap:8px;padding:8px 16px;border-radius:999px;background:' + C.bg + ';' +
    'border:1px solid rgba(76,195,138,.5);box-shadow:0 12px 40px rgba(0,0,0,.45);' +
    'color:' + C.text + ';font-size:12.5px;pointer-events:none;white-space:nowrap;'
  );
  var okMark = makeEl('span',
    'width:16px;height:16px;border-radius:50%;background:#4cc38a;color:#fff;display:inline-flex;' +
    'align-items:center;justify-content:center;font-size:11px;font-weight:800;'
  );
  okMark.textContent = '\u2713';
  var successText = makeEl('span');
  successPill.appendChild(okMark);
  successPill.appendChild(successText);
  uiRoot.appendChild(successPill);
  var successTimer = 0;
  function flashSuccess(msg) {
    successText.textContent = msg;
    successPill.style.display = 'flex';
    clearTimeout(successTimer);
    successTimer = setTimeout(function () { successPill.style.display = 'none'; }, 2200);
  }

  /* =================== 事件 =================== */
  function onClick(e) {
    var t = e.target;
    // 覆盖层点击交由各自 handler，不能 stopPropagation（capture 截断会让按钮收不到点击）
    if (isUIEl(t)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!isPinnable(t)) return;
    clearHover(); hideTip();
    if (S.mode === 'single') {
      lockSelection(t);
      openComposer();
    } else {
      toggleMulti(t);
      // 首个元素选中即打开 Composer，后续点击实时更新 chips（不丢已输入内容）
      if (S.multiSel.length > 0) openComposer();
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      // 语义判断「Composer 是否打开」：display 解析为空/其他值时视为关闭
      if (composer.style.display === 'flex') {
        // 多选：清空选择并关闭（避免关掉后无法重新打开的死路）
        if (S.mode === 'multi' && S.multiSel.length > 0) clearMulti();
        closeComposer();
        return;
      }
      cancelAndNotify();
      return;
    }
    if (composer.style.display === 'flex' && e.target === ccInput) {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        sendPrompt();
      }
    }
  }

  function onScroll() {
    if (S.mode === 'single' && S.selectedEl) {
      var r = S.selectedEl.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) {
        clearSingle();
      } else {
        updateCornerBadges(S.selectedEl);
        positionSelBar(S.selectedEl);
      }
    }
    if (S.mode === 'multi') { renderNumBadges(); }
    clearHover(); hideTip();
  }

  /* =================== 生命周期 =================== */
  function startPicker() {
    S.oldCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    updateModeText();
    renderModeSwitch();
  }
  function cleanupPicker() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
    clearHover(); hideTip(); clearSelected();
    document.body.style.cursor = S.oldCursor;
  }
  function cleanupAll() {
    cleanupPicker();
    if (uiRoot) uiRoot.remove();
    if (styleEl) styleEl.remove();
    window.__NEEKO_PICKER__ = null;
  }
  function cancelAndNotify() {
    cleanupAll();
    notify('picker-cancelled');
  }

  window.__NEEKO_PICKER__ = { stop: cleanupAll };

  // ---- 启动 ----
  startPicker();
})();
