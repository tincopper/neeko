# 事件名常量抽取(P0)

## Goal

消除浏览器事件名双端硬编码。`browser://url-changed` / `page-loaded` / `loading` / `open-url` / `prompt-submitted` / `picker-cancelled` 在 Rust 端(commands.rs、uri_scheme.rs)与前端(useBrowserPanel.ts、useBrowserPicker.ts)共硬编码 12 处,违反 Review Gate #5 与 `shared/events.ts`"禁止硬编码事件字符串"契约。

## Requirements

* Rust 端在 browser 模块定义 `pub const` 事件常量(如 `EVENT_URL_CHANGED` 等),所有 `emit` 处引用
* 前端在 `src/shared/events.ts` 定义对应常量(BROWSER_* 前缀),useBrowserPanel/useBrowserPicker 引用
* 双端常量值保持一致(单一事实源注释互指)

## Acceptance Criteria

* [ ] `grep -rn "browser://" src src-tauri/src` 仅命中常量定义处,无业务代码硬编码
* [ ] 事件功能回归:url 同步、loading、open-url、prompt-submitted、picker-cancelled 正常
* [ ] `pnpm type-check` + `pnpm lint:fe` + `cargo test --manifest-path src-tauri/Cargo.toml` 通过

## Out of Scope

* 事件 payload 结构变更(保持 `{label, ...}` 格式)
