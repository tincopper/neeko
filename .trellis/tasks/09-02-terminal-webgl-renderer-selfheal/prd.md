# 终端 WebGL 渲染层乱码自愈与精细度对齐

## Goal

GPU 加速下 WKWebView 静默失效化 WebGL 字形图集/绘图缓冲导致终端偶发乱码（缓冲数据完好，resize 可愈）。落地：重新可见时 `clearTextureAtlas` 自愈 + `onContextLoss` 冷却重载与 Canvas 降级 + 打点；同时把 WebGL 精细度对齐到 orca 基准（消除 opencode 大字块内横向白缝，保留 `fontWeight 300 / lineHeight 1.0` 已验证收益）。

## Background

- orca 同屏对照：orca（WebGL）块字实心无缝，neeko（WebGL）`opencode` 大字块内有横向白线。
- 已确认有效、予以保留：`fontWeight 300` + `lineHeight flat 1.0`（间隙变小、割裂感减轻，Retina dpr=2 / 14px → 28 device px 整数 cell）。
- 已定位主因：neeko 全局 `customGlyphs:false` 使块/框线走 JetBrains Mono 字体字形（不满格留缝）；orca 保持默认 `true` 走矢量 `fillRect`，实心无缝。

## Requirements

- R1 自愈（正确性）：tab 切换 attach/detach 后图集失同步 → `clearTextureAtlas` + 强制重绘自愈；多 tab 配额逐出 → `suspend/resume` 治理；`onContextLoss` → 冷却重载（≤2 次、30s 窗口）或降级 Canvas，全路径打点。
- R2 精细度（对齐 orca）：WebGL 路径块/框线恢复矢量绘制（`customGlyphs:true`），整数 cell（`lineHeight 1.0`）保留以治灰边；`heal` 后强制 `refresh(0, rows-1)`，避免清完图集仍残留 stale 帧。
- R3 字体竞态：保留 P0-A `ensureTerminalFontsReady` 门闩 + P0-B `fonts.ready` 兜底 heal；P0-B 不受 attach-heal 的 30s 节流吞没（独立时间戳/绕过节流）。
- R4 资源释放：`suspend` 除 `dispose()` 外补 `WEBGL_lose_context.loseContext()` + canvas 清零（对齐 orca `disposeWebgl`）；`reload` 失败清理注册表脏引用。
- R5 依赖：`xterm 6.1.0-beta.287` + `addon-webgl 0.20.0-beta.286` 与 orca 基线一致，予以保留并记录依据；不回退稳定版。
- 约束：改动限终端渲染层（`shared/utils/terminal.ts`、`typography.ts`、`webglRecovery.ts`、两创建路径、TaskConsole）；`Terminal` 选项按渲染器分支，Canvas 路径行为不变；`TerminalPanel` “blockier”文案回滚为实验性说明。

## Acceptance Criteria

- [ ] AC1：GPU 开启时复现图集失同步（tab 切走切回）→ 自动恢复，无中文断裂/白缝残留，无需手动 resize。
- [ ] AC2：同屏对照（Canvas / WebGL / orca）：opencode 大字块内无横向白线，200% 放大下 WebGL 与 orca 一致。
- [ ] AC3：`300 / 1.0` 保留：行盒无裁剪（下划线/块下半可见），`--line-height-terminal` 与 `resolveTerminalLineHeight` 同步。
- [ ] AC4：`pnpm test:run`（含 `terminalRenderer` / `webglRecovery` / `typography`）+ `pnpm type-check` + `pnpm lint:fe` 全绿。
- [ ] AC5：降级/重载路径均打点（`terminal.renderer.recovery` / `terminal.renderer.resume`），无静默降级。

## Non-Goals

- 不做按内容自动切换渲染器（TUI 用 Canvas、大输出用 WebGL）；渲染器仍由确定性 `RendererPlan` + 用户 GPU 开关决定。
- 不做 Canvas 路径的块字形/字重调整；不碰后端 PTY/drain 链路。

## Notes

- 产品取舍（已确认）：WebGL 继续打磨；基准环境 macOS Retina 默认（14px + JBM 默认栈 + GPU 开启）。
- `prd.md` 只收需求与验收；技术设计见 `design.md`，执行清单见 `implement.md`。
