# Browser Picker Notify Base URL — Cross-Platform Fix

## Goal

修复 Browser Panel 中元素选择器（AI 辅助修改 UI）功能在 macOS 与 Linux 上完全无法工作的问题。

根因：`src-tauri/src/commands/browser.rs` 的 `PICKER_SCRIPT` 在通知 Rust 侧（prompt-submitted / picker-cancelled / element-picked）时硬编码了 Windows 专用的访问形式 `http://neeko.localhost/<path>`，而 macOS（WKWebView）/ Linux（WebKitGTK）下 Tauri 自定义 URI scheme 必须通过 `neeko://localhost/<path>` 访问。

## What I already know

- 自定义 URI scheme `neeko` 注册位于 `src-tauri/src/app.rs:65`：`.register_uri_scheme_protocol("neeko", crate::uri_scheme::create_handler())`
- 处理器位于 `src-tauri/src/uri_scheme.rs`，识别三类请求：`prompt-submitted`、`picker-cancelled`、`element-picked`，依据 `uri.contains(...)` 走分支。
- 注入脚本位于 `src-tauri/src/commands/browser.rs::PICKER_SCRIPT`（`notify(path)` 函数 line 289-291）。
- 前端监听 `browser://prompt-submitted`、`browser://picker-cancelled` 在 `src/hooks/useBrowserPanel.ts`。
- Mac 上 picker 注入、高亮、AI 输入框 UI 正常；只有"通知 Rust"链路断了 → 表现为提交后无响应。
- Tauri 2 的 `register_uri_scheme_protocol` 平台行为：
  - Windows: 走 `http://<scheme>.localhost/<path>`
  - macOS / Linux: 走 `<scheme>://localhost/<path>`

## Requirements

- macOS、Linux 浏览器面板 picker 提交 prompt 后能正确触发 Rust 端 `uri_scheme` handler，并 emit `browser://prompt-submitted` 事件。
- Windows 行为保持不变（不能回归）。
- `picker-cancelled`、`element-picked`（剪贴板复制 outerHTML）三条通道在三个平台都生效。
- 注入脚本里仍只有一份 `PICKER_SCRIPT`，平台差异由 Rust 编译期决定，不在 JS 里做 `navigator.userAgent` 嗅探。

## Acceptance Criteria

- [ ] macOS 下打开 Browser Panel → 选元素 → 输入 prompt 回车 → 终端收到 `formatPickerMessage` 拼好的内容（含 `@<url>`、prompt、HTML 代码块）。
- [ ] macOS 下按 ESC / 点 ✕ / 点击 prompt 输入框外部 → picker 重新进入元素选择阶段（说明 `browser://picker-cancelled` 触发）。
- [ ] macOS 下选中一个元素后剪贴板含该元素 outerHTML（`element-picked` 路径）。
- [ ] Linux 同上（行为对齐）。
- [ ] Windows 行为无回归（`http://neeko.localhost/...` 链路仍然走通）。
- [ ] `cargo test` 与现有 `uri_scheme` 单测全绿；如果新增编译期常量，覆盖与之相关的轻量断言或 doc-comment 即可。

## Definition of Done

- 改动集中在 `src-tauri/src/commands/browser.rs`（注入脚本与 base URL 拼装）。
- 不需要前端改动；不需要修改 capabilities / tauri.conf.json。
- `cargo check` / `cargo test` 通过。
- 手测覆盖三个平台中至少 macOS（开发主机）+ Windows（保底回归）。

## Out of Scope

- 不重构 picker UI / 文案 / 主题逻辑。
- 不改 `uri_scheme.rs` 的 handler 分支（已经按 `uri.contains` 匹配，base URL 变化对它透明）。
- 不引入前端 platform 检测；不引入 runtime UA 嗅探。
- 不改其他 Tauri 自定义协议（如 `asset://`）。

## Technical Approach

在 `browser.rs` 增加 `cfg!(target_os = "windows")` 编译期常量 `NOTIFY_BASE`：

```rust
#[cfg(target_os = "windows")]
const NOTIFY_BASE: &str = "http://neeko.localhost/";

#[cfg(not(target_os = "windows"))]
const NOTIFY_BASE: &str = "neeko://localhost/";
```

在 `browser_start_picker` 注入脚本时，把 `NOTIFY_BASE` 一起作为 `window.__NEEKO_NOTIFY_BASE__` 写入：

```rust
let script = format!(
    "window.__NEEKO_THEME__ = {};\nwindow.__NEEKO_NOTIFY_BASE__ = {};\n{}",
    theme_json,
    serde_json::to_string(NOTIFY_BASE).unwrap(),
    PICKER_SCRIPT
);
```

`PICKER_SCRIPT` 里 `notify` 改为读取该变量，保留 fallback：

```js
function notify(path) {
    try {
        var base = window.__NEEKO_NOTIFY_BASE__ || 'http://neeko.localhost/';
        var i = new Image(); i.src = base + path;
    } catch(ex) {}
}
```

注意：`reinjectPicker`（`useBrowserPanel.ts:327`）也走 `browser_start_picker` invoke，所以每次重注入都会带上正确的 base URL，无需额外改动。

## Decision (ADR-lite)

**Context**: macOS / Linux 上 `register_uri_scheme_protocol` 的访问形式与 Windows 不同，picker 脚本硬编码 Windows 形式导致跨平台失效。

**Decision**: 在 Rust 编译期决定 base URL，通过 `window.__NEEKO_NOTIFY_BASE__` 注入给脚本使用。

**Alternatives considered**:
- 在 JS 里 `navigator.platform` / `userAgent` 嗅探：脆弱，且 webview 的 UA 不一定可靠。
- 在前端 `useBrowserPanel` 里通过 `@tauri-apps/plugin-os` 拿平台再通过参数传给 `browser_start_picker`：增加额外 round-trip，且 Rust 已经知道目标平台。

**Consequences**: 改动范围最小（单文件），编译期常量零运行时开销，不引入新依赖。日后若 Tauri 改 URL 模式，只需调整 `NOTIFY_BASE` 一处。

## Technical Notes

- 关键文件：
  - `src-tauri/src/commands/browser.rs`（PICKER_SCRIPT、browser_start_picker）
  - `src-tauri/src/uri_scheme.rs`（handler 不需要改）
  - `src-tauri/src/app.rs`（scheme 注册不需要改）
  - `src/hooks/useBrowserPanel.ts`（消费端不需要改）
- `serde_json::to_string` 序列化字符串自动包裹双引号并转义，避免手拼 JSON 字符串。
- 当前 `uri_scheme.rs` handler 用 `uri.contains("prompt-submitted")` 匹配 path，对 base URL 变化透明。
- `tauri.conf.json` 里 `csp: null`，不会阻塞 `neeko://` 协议加载。

## Open Questions

（无 — 范围明确，待用户确认 PR 拆分粒度后即可实施。）
