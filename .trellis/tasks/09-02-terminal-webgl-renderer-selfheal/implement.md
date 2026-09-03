# 执行计划：WebGL 自愈 + 精细度对齐

## 0. 前置（TDD 红灯先行）

- 先补失败测试再改业务：`terminalRenderer.test.ts` 追加 —— WebGL 装载点以 `{ customGlyphs: true }` 构造 addon；heal 后调用 `refresh(0, rows-1)`；P0-B 不受 attach 节流影响；reload 失败清注册表。
- 确认红（新断言失败）→ 再绿（最小实现）→ 重构对齐本设计。

## 1. 有序清单

- [x] 1. `terminal.ts`：`WebglAddonLike` 扩展构造语义；`mountWebglAddon` 接收 `customGlyphs:true` 并在三装载点生效；`new Terminal` 相关注释更新（不传该字段）。
  - 注：工作树实测 `new Terminal()` 从未真正携带 `customGlyphs`（LSP 旧报错为 stale），无需删除动作。
- [x] 2. `terminalFactory.ts` / `TerminalViewBase.tsx` / `TaskConsoleOutput.tsx`：确认 `Terminal` 构造无 `customGlyphs`（同上，无动作）。
- [x] 3. `terminal.ts`：`healWebglRenderer` 追加 `refresh(0, rows-1)`（try/catch）；P0-B 独立 `fontHealAt` 时间戳（`RendererMeta` 新增字段，不复用 `lastHealAt`）。
- [x] 4. `terminal.ts`：`suspendWebglRenderer` 补 `loseContext + canvas.width/height=0`（读 `_renderer` 内部，全程 try/catch）；`reloadWebglAddon` 失败删 `webglAddons` 脏引用。
- [x] 5. `TerminalPanel.tsx`：选项 A 终局文案（Canvas 推荐 + WebGL quad 缝说明，design §12）。
- [x] 6. 单测全绿 + 类型门禁清零（`terminalRenderer` 41 用例含新增退订/守卫测试）。
- [x] 7. 目检：E1 Canvas 干净 / E2 证伪整数理论 → 选项 A 收敛（design §8/§10）。

## 5. neeko-check Warn 返工（2026-09-03，0 Block 4 Warn → 全修）

- [x] W1：注册表升级为 `{ addon, unsubscribe }` + `toUnsubscribe` 归一化（裸函数 / Disposable 皆容）；`disposeRegistration` 统一收口退订+放配额+dispose，供 suspend/reload/degrade 三路调用；新增退订三测试（suspend/reload/degrade 后旧链静默）。
- [x] W2：`applyRenderer` webgl 分支补 `isTerminalDisposed/hasLinkifier` 守卫（与 canvas 同形）；新增两测试。
- [x] W3：cleanup 按本 effect `cacheKey` 条目精确 suspend（`staleEntry?.term ?? 同 key 的 currentTermRef`，key 已切换则跳过）；本文件无组件挂载测试基建（pre-existing 缺口，P3），以 tsc+eslint+全量 suite 为证。
- [x] W4：TaskConsole 过期注释修正（flat 1.0）。
- [x] 附带：degrade 分支补 `disposeRegistration`（heal 不再打废 addon，有测试覆盖）。

## 2. 验证命令

```bash
pnpm test:run -- src/shared/utils/__tests__/terminalRenderer.test.ts src/shared/utils/__tests__/webglRecovery.test.ts src/shared/utils/__tests__/typography.test.ts
pnpm type-check
pnpm lint:fe
```

## 3. Review gates

- `neeko-check`：命令执行统一接口、Event 常量化、Command 极薄、换行边界与本任务无关项跳过；重点看 `WebglAddon` 构造类型断言宽度与 `any` 禁用。
- 跨层：只动前端渲染层，无 Rust/IPC/存储格式变更。

## 4. 回滚点

- R-a：白缝未消 → 回退 `customGlyphs` 构造参数（保留其它自愈链）。
- R-b：refresh 引入闪烁 → 仅回退第 3 步的 refresh，保留 clear。
- R-c：loseContext 导致 resume 变慢 → 仅回退第 4 步前半。
- 每次回滚后重跑第 2 节命令。
