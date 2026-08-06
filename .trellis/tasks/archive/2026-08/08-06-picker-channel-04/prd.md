# Picker HTML 回传通道改造(P1)

## Goal

消除元素选择器(picker)选中 HTML 经 `img.src` 查询字符串回传的长度截断风险。当前 `PICKER_SCRIPT` 的 `notify()` 将 `?html=<整个 outerHTML>` 编码进 URL,大 DOM 有被 webview URL 上限截断的风险。

## Requirements

* 改造 `neeko://` 协议回传:大体积 HTML 不走查询字符串
* 方案 A(优先):Tauri 2 `webview.postMessage` → 前端 `on_message` 监听,HTML 作为结构化消息体
* 方案 B:HTML 写入页面 `localStorage` 中转,`neeko://` 仅回传引用 key,Rust 侧从引用取值
* 保留 `prompt-submitted` / `picker-cancelled` / `element-picked` 三类事件语义
* `NOTIFY_BASE` 跨平台差异适配逻辑保留(如走方案 A 可简化)

## Acceptance Criteria

* [ ] 选中 >100KB DOM 回传不截断、内容完整
* [ ] picker 全流程回归:高亮、选中、prompt 提交、取消
* [ ] `cargo test --manifest-path src-tauri/Cargo.toml` + `pnpm test:run` 通过

## Out of Scope

* picker 跨 iframe 支持(独立项)
* picker mousemove 节流(独立项)
