//! Picker 注入脚本(浏览器元素选择器)。
//!
//! 由 `src-tauri/src/browser/commands.rs` 的 `include_str!("picker_script.js")` 消费,
//! 随 `browser_start_picker` 命令注入浏览器 webview。
//!
//! 脚本通过 `window.__NEEKO_THEME__`(主题色)与 `window.__NEEKO_NOTIFY_BASE__`
//! (neeko:// 协议 base)配置,经 `fetch POST` 向 Rust 回传 picker 消息。
//!
//! 修改本文件后无需重启 Rust 编译缓存——include_str! 会跟踪文件变更。
(function() {
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

  var oldTarget = null;
  var oldOutline = '';
  var oldCursor = '';
  var tooltip = null;
  var codeStyle = null;
  var promptBar = null;
  var outsideListener = null;
  var skipNextClick = false;

  function notify(type, data) {
    try {
      var base = window.__NEEKO_NOTIFY_BASE__ || 'http://neeko.localhost/';
      var payload = JSON.stringify(Object.assign({ type: type }, data || {}));
      fetch(base + type, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }).catch(function() {});
    } catch(ex) {}
  }

  function createTooltip() {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;z-index:2147483647;background:' + C.bg + ';color:' + C.text + ';padding:2px 8px;border-radius:3px;font:12px/1.6 system-ui,-apple-system,sans-serif;pointer-events:none;white-space:nowrap;max-width:50vw;overflow:hidden;text-overflow:ellipsis;border:1px solid ' + C.border;
    document.documentElement.appendChild(el);
    return el;
  }

  function getCodeStyle() {
    var s = document.createElement('span');
    s.style.cssText = 'color:' + C.muted + ';margin-left:4px';
    return s;
  }

  function getSelector(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).join('.');
    return s;
  }

  function getSize(el) {
    var r = el.getBoundingClientRect();
    return Math.round(r.width) + '\u00d7' + Math.round(r.height);
  }

  function onMove(e) {
    var t = e.target;
    if (!t || t === document.documentElement || t === document.body) return;
    if (t === tooltip || (tooltip && tooltip.contains(t))) return;
    if (oldTarget) { oldTarget.style.outline = oldOutline; }
    oldTarget = t;
    oldOutline = t.style.outline;
    t.style.outline = '2px solid ' + C.accent;
    tooltip.textContent = getSelector(t);
    if (!codeStyle) codeStyle = getCodeStyle();
    codeStyle.textContent = getSize(t);
    if (!tooltip.contains(codeStyle)) tooltip.appendChild(codeStyle);
    var r = tooltip.getBoundingClientRect();
    var x = e.clientX + 12;
    var y = e.clientY + 16;
    if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 4;
    if (y + r.height > window.innerHeight) y = e.clientY - r.height - 8;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function cleanupPicker() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onPickerKey, true);
    if (oldTarget) { oldTarget.style.outline = oldOutline; }
    if (tooltip) tooltip.remove();
    document.body.style.cursor = oldCursor;
  }

  function removeOutsideListener() {
    if (outsideListener) {
      document.removeEventListener('mousedown', outsideListener, true);
      outsideListener = null;
    }
  }

  function cleanupPrompt() {
    removeOutsideListener();
    if (promptBar) { promptBar.remove(); promptBar = null; }
  }

  function cleanupAll() {
    cleanupPicker();
    cleanupPrompt();
    window.__NEEKO_PICKER__ = null;
  }

  function cancelAndNotify() {
    cleanupAll();
    notify('picker-cancelled');
  }

  /** Re-enter Phase 1 (crosshair + hover highlight + click to select).
   *  skipNextClick prevents the click that dismissed the prompt (via
   *  mousedown-outside) from immediately selecting a new element. */
  function startPicker() {
    if (oldTarget) { oldTarget.style.outline = oldOutline; oldTarget = null; }
    oldCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    tooltip = createTooltip();
    codeStyle = null;
    skipNextClick = true;
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onPickerKey, true);
  }

  /* ---- Phase 2: inline prompt textarea ---- */

  function showPromptInput(html, cx, cy) {
    var W = 450;
    var LINE_H = 20;
    var MAX_LINES = 5;

    var bar = document.createElement('div');
    bar.style.cssText = 'all:initial;position:fixed;z-index:2147483647;display:flex;align-items:flex-start;gap:6px;padding:6px 10px;border-radius:8px;border:1px solid ' + C.border + ';background:' + C.bg + ';backdrop-filter:blur(8px);box-shadow:0 4px 24px rgba(0,0,0,.4);font:13px/1.4 system-ui,-apple-system,sans-serif;color:' + C.text + ';width:' + W + 'px;box-sizing:border-box';

    var x = cx + 8;
    var y = cy + 20;
    if (x + W > window.innerWidth) x = window.innerWidth - W - 8;
    if (x < 8) x = 8;
    if (y + 40 > window.innerHeight) y = cy - 52;
    if (y < 8) y = 8;
    bar.style.left = x + 'px';
    bar.style.top = y + 'px';

    var label = document.createElement('span');
    label.textContent = 'AI';
    label.style.cssText = 'all:initial;color:' + C.accent + ';font:600 12px/20px system-ui,-apple-system,sans-serif;flex-shrink:0;user-select:none';

    var ta = document.createElement('textarea');
    ta.placeholder = 'describe how to modify this element...';
    ta.rows = 1;
    ta.style.cssText = 'all:initial;flex:1;background:transparent;border:none;outline:none;color:' + C.text + ';font:13px/1.4 system-ui,-apple-system,sans-serif;min-width:0;resize:none;overflow:hidden;height:' + LINE_H + 'px;max-height:' + (LINE_H * MAX_LINES) + 'px;display:block';

    function autoGrow() {
      ta.style.height = 'auto';
      var h = Math.min(ta.scrollHeight, LINE_H * MAX_LINES);
      ta.style.height = h + 'px';
      if (ta.scrollHeight > LINE_H * MAX_LINES) {
        ta.style.overflowY = 'auto';
      } else {
        ta.style.overflowY = 'hidden';
      }
    }
    ta.addEventListener('input', autoGrow);

    var closeBtn = document.createElement('span');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = 'all:initial;color:' + C.muted + ';cursor:pointer;font:14px/20px system-ui;flex-shrink:0;padding:0 2px;user-select:none';
    closeBtn.onmouseover = function() { closeBtn.style.color = C.text; };
    closeBtn.onmouseout  = function() { closeBtn.style.color = C.muted; };
    closeBtn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); cancelAndNotify(); };

    bar.appendChild(label);
    bar.appendChild(ta);
    bar.appendChild(closeBtn);
    document.documentElement.appendChild(bar);
    promptBar = bar;

    setTimeout(function() { ta.focus(); }, 0);

    ta.addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (e.shiftKey || e.ctrlKey || e.altKey) {
          /* allow newline — browser default inserts \n in textarea */
          setTimeout(autoGrow, 0);
          return;
        }
        e.preventDefault();
        var prompt = ta.value.trim();
        if (!prompt) return;
        notify('prompt-submitted', { prompt: prompt, html: html });
        cleanupPrompt();
        startPicker();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelAndNotify();
      }
    }, true);

    /* Prevent clicks inside bar from propagating (bubbling phase so child
       elements like closeBtn still receive their own click events first) */
    bar.addEventListener('click', function(e) { e.stopPropagation(); });
    bar.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    /* Click outside: close prompt input and return to element selection */
    setTimeout(function() {
      outsideListener = function(e) {
        if (promptBar && !promptBar.contains(e.target)) {
          cleanupPrompt();
          startPicker();
        }
      };
      document.addEventListener('mousedown', outsideListener, true);
    }, 50);
  }

  /* ---- Phase 1: hover + click ---- */

  function onClick(e) {
    if (skipNextClick) { skipNextClick = false; return; }
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var html = el.outerHTML;
    cleanupPicker();
    notify('element-picked', { html: html });
    showPromptInput(html, e.clientX, e.clientY);
    return false;
  }

  function onPickerKey(e) { if (e.key === 'Escape') cancelAndNotify(); }

  oldCursor = document.body.style.cursor;
  document.body.style.cursor = 'crosshair';
  tooltip = createTooltip();
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onPickerKey, true);
  window.__NEEKO_PICKER__ = { stop: cleanupAll };
})();
