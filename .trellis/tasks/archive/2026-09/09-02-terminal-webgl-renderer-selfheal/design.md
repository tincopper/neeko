# 设计：WebGL 乱码自愈 + 精细度对齐 orca

## 1. 边界

- 在内：`src/shared/utils/terminal.ts`（渲染器编排）、`webglRecovery.ts`（纯决策）、`typography.ts`（P0-A 门闩）、两创建路径（`terminalFactory.ts`、`TerminalViewBase.tsx`）、`TaskConsoleOutput.tsx`（只读台词一致性）、`TerminalPanel.tsx` 文案。
- 在外：后端 PTY/drain/credit-pull、xterm 版本升级之外的一切、Canvas 渲染行为。

## 2. 关键发现（决定本方案形状）

- D1 `customGlyphs` 放错了位置：当前代码把它传给 `new Terminal()`，但所装 `xterm 6.1.0-beta` 的 `ITerminalOptions` 根本没有该字段（typecheck 已报错），实际是 no-op；白缝因此纹丝不动。orca 的 e2e 证明它是 `new WebglAddon({ customGlyphs })` 的构造参数。修复 = 从 `Terminal` 选项移除，改到三个 WebGL 装载点（`loadWebglRenderer` / `reloadWebglAddon` / `resume` 经由的 `mountWebglAddon`）统一传入。
- D2 orca 默认即 `customGlyphs:true`（从不显式设 false），块/框线走矢量 `fillRect` → 实心无缝；`lineHeight` 下限 1、无全局缩放模型。neeko 已验证 `300/1.0` 有效，予以保留。
- D3 orca 自愈 = `clearTextureAtlas + 过暂停门强制重绘 + refresh(0, rows-1)`；neeko 缺后两步，清完图集仍可能残留 stale 帧。
- D4 orca 释放 = `dispose + loseContext + canvas.width/height=0`；neeko 只 `dispose`，配额回收靠 GC，不彻底。

## 3. 决策

| # | 决策 | 理由 | 备选（否决原因） |
|---|------|------|------------------|
| 1 | WebGL addon 统一 `new WebglAddon({ customGlyphs: true })`（如构造器不支持则回退无参并记录） | 对齐 orca 及官方文档（矢量连续线），消除“字体不满格”变量 | 全局 false（白缝根源之一）；继续放 Terminal 选项（类型错误 + 无效） |
| 1b | **D1 已被证伪（2026-09-03 实测）**：`customGlyphs:true` 后白缝仍在（横+竖）→ 缝不在字形光栅化，而在 cell 四边形层级。见 §7 | ---
| 2 | 保留 `fontWeight 300 + Light @font-face`、`lineHeight 1.0` | 用户已验证间隙/割裂感改善 | 回滚到 400/1.2（退化已验证收益） |
| 3 | `healWebglRenderer` 后追加 `term.refresh(0, rows-1)`（try/catch 包裹） | 清图集后必须重画，否则 stale 帧残留 | 只 clear 不 refresh（当前缺口） |
| 4 | P0-B 字体兜底 heal 用独立时间戳，不受 attach-heal 30s 节流约束 | 否则启动期常驻终端的首帧锁死补不回来 | 共用 `lastHealAt`（会被吞） |
| 5 | `suspend` 补 `loseContext + canvas 清零`（读 addon 内部 `_renderer`，全程 try/catch，拿不到则跳过） | 对齐 orca，配额立即回收 | 只 dispose（回收滞后） |
| 6 | `reload` 失败时从 `webglAddons` 删脏引用 | 否则后续 heal 打在废 addon 上 | 保留（逻辑脏） |
| 7 | `onContextLoss` 保持 reload≤2 + 30s 冷却 + 降级 Canvas + 打点（不照搬 orca 的 latch 到 DOM） | neeko 是 Canvas 降级语义（DOM 会内存风暴），reload 给 GL 一次自救机会 | latch 到 DOM（引入内存风险）；无限 reload（风暴） |
| 8 | 保留 beta 依赖并记录依据（与 orca 同基线 `6.1.0-beta.287 / 0.20.0-beta.286`） | 排除版本干扰，A/B 可比 | 回退稳定版（与对照基线分叉） |

## 4. 数据流/调用链

```
创建: ensureTerminalFontsReady(门闩) → open → applyRenderer(plan)
  plan=webgl → mountWebglAddon(new WebglAddon({customGlyphs:true}), 订阅onContextLoss, registerFontsReadyHeal[P0-B独立戳])
  plan=canvas → CanvasAddon（不变）
切走: cleanup → suspendWebglRenderer(dispose + loseContext + canvas清零, meta.suspended=true)
切回: attach → resumeWebglRenderer(重建addon+恢复链) + healWebglRenderer(clear + refresh, attach节流) 
字体就绪晚到: fonts.ready → P0-B heal(独立戳, clear + refresh)
丢失: onContextLoss → planWebglRecovery(reload|degrade) → reloadWebglAddon 或 Canvas降级 + 打点
```

## 5. 契约与不变量

- `RendererMeta` 仍是跨 suspend 唯一状态持有（plan/state/suspended/canvasFallback/attach用lastHealAt + 新增fontHealAt）。
- `heal` 幂等：非 WebGL 无注册项 → no-op；`clear/refresh` 抛错吞掉，失败不推进对应时间戳（下个边界重试）。
- `Terminal` 构造选项不再出现 `customGlyphs`（类型门禁）；Canvas 装载路径零改动（唯一的全局选项变更 `fontWeight 300` 为已验证收益，见 §6）。
- 降级/重载失败必打点（`RENDERER_EVENT_RECOVERY` / `RENDERER_EVENT_RESUME` / `RENDERER_EVENT_WEBGL[_NULL]` / `RENDERER_EVENT_CANVAS`，常量见 `terminal.ts`，支柱 12），禁止静默。

## 6. 兼容与回滚

- 按渲染器分支：用户字体/字号/主题逻辑不动；`fontWeight 300` 为全局 Terminal 选项（Canvas 同受影响，属已验证收益而非 Canvas 行为变更，见决策 2）；自定义无 Light 面字体静默回退 400（现状，保持）。
- beta 287 附带 API 变更：`ITerminalOptions.overviewRuler` 已移除（改走 `scrollbar.width`，缺省即无 ruler），两创建路径删除旧选项是升级必需（W1，2026-09-03 review）；`detectActiveRenderer` 的私有结构嗅探（`_renderService._renderer.value` + `_gl`/`_renderLayers`/`_rowContainer`）随上游升 300/304 必须回归。
- 2026-09-03 review 回退工作树 `lowp→highp` shader 补丁（fork 级改动，无 A/B 证据，与 §11/§12“不再做几何/fork 级改动”冲突）：stock addon 恢复，自愈链先合，精度问题另起任务。
- 回滚点正交：customGlyphs398 / refresh / loseContext / P0-B独立戳 / 脏引用清理可逐个回滚，不动恢复计数器与门闩。

## 7. 缝的双机制（2026-09-03，stock core 实测代码确认）

upstream `RenderService._updateDimensions`（`xterm.mjs`）：

```
device.char.width  = charWidth_css * dpr        // JBM@14/dpr2 = 8.4*2 = 16.8，小数，不取整
device.char.height = ceil(charHeight_css * dpr)
device.cell.width  = device.char.width + round(letterSpacing)  // letterSpacing 按 CSS 取整后加到 device 轴，步进 1 device px
device.cell.height = floor(device.char.height * lineHeight)    // lineHeight 1.0 → 整数，行高轴天然对齐
```

- **竖缝**：`device.cell.width` 小数 → 相邻 quad 共享小数边 → 光栅化裂缝透出 cell 背景色。Canvas 是立即模式绘制无相邻 quad，故干净；与字体/矢量无关。
- **横缝**（半块 `▀▄` 阴影区）：cell 高整数无行间隙 → 属图集 LINEAR 采样 bleed（相邻图集纹素渗入），与 orca 多页图集 fork 的差异方向一致。
- **死胡同**：`letterSpacing` 补偿宽度不可行（`round()` 单位混杂，最小步进 1 device px，16.8 凑不成整数）。
- orca 干净的最可能解释：7MB core patch 动了上述取整，或其多页图集改了采样；未实锤，需 §8 实验先排除“对比基准本身就不是 WebGL”。
- `customGlyphs:true` 保留（官方默认 + 文档推荐），但不再声称治缝。

## 8. 实测结果（2026-09-03，用户返图）与理论修正

- E1：关 GPU（Canvas）→ **完全干净**。锁定：缝是 WebGL 专属，与字体无关。
- E2：字号 15（预测整数 cell 18×30）→ **缝反而更大、全格栅**。整数 cell 理论**同步证伪**（JBM 表称 advance 恰为 0.6em，15px 下 18.0 应为零误差，实测反之）。
- E3：orca 禁 devtools → 对照基线不可验证，悬置。
- 上游 issue #6015（2026-06）：WebGL addon 侧 `floor(device char width)` 与 DOM 侧不取整并存，但解释的是跨渲染器 reflow，非 WebGL 自洽性；不能直接解释 E1/E2。
- 结论：静态分析 exhausted。缝的完整机制需运行时数字（dpr / 实测 advance / bitmap 与 CSS 尺寸）才能定论；在此之前不再做几何侧改动。
- `customGlyphs:true` 保留（官方默认），`300/1.0` 保留（用户验证间隙收益），自愈链保留（治乱码有效）。

## 10. 像素对照48285386（三金子，自研 harness + Chrome headless dpr=2）

- beta ≡ 0.19 **像素级完全一致**（同 md5）：版本回归理论**死**。几何取整/块形状代码双版本一致，互相印证。
- headless 下两者皆干净、无缝：缝需要真实环境触发（Metal/ANGLE、真实字体度量管线），harness 复现不了。
- 副发现：beta core `CharSizeService` 优先 OffscreenCanvas 度量 `"W"` **墨水宽**（非 advance），失败才回退 DOM；headless 下该路径疑似拿不到 webfont（量出 8.0 而非 8.4）。含义：P0-A 门闩只保 `document.fonts`，**不保 OffscreenCanvas 度量路径**——门闩覆盖有缺口（待证，仅记录，不据此改码）。
- 排除链：Terminal 位 `customGlyphs`（core+addon 双读码确认无此读取，纯 no-op）→ 死；整数 cell（E2 反向）→ 死；beta 回归（本节）→ 死。
- 唯一存活：小数 device cell 下 WebGL 相邻 quad 覆盖裂缝（Canvas 立即模式无此构件，故 E1 干净；属上游已知类别，见 #6015 家族），但**无法从代码推导出“优化前干净”**——回归因果未闭合，待 §11 的受控 A/B。

## 11. 待用户受控 A/B（同 art、同窗口、不重编，2 分钟，定因果）

- G1：`lineHeight 1.0/fontWeight 300`（现状）截图 → G2：改回 `1.2/400` 同屏截图。
- G2 干净 → 回滚几何两项（保留自愈链），任务收敛。
- G2 同样有缝 → “优化前干净”为记忆混杂（内容/缩放/版本叠加），走选项 A（默认 Canvas）。

## 12. 终局（2026-09-03，用户确认选项 A）

- 产品决策：默认 Canvas（`terminalGpuAcceleration` 全链默认 `false`，无需改逻辑），WebGL 仅大输出 opt-in；`TerminalPanel` 文案如实说明（Canvas 像素完美在先，WebGL 块 art 缝为上游 quad 伪影、无公开调参）。
- 本任务交付：乱码自愈链（AC1/AC4/AC5）+ 精细度排出链（§7–§11 分析资产）+ 上述文案。不再做几何/fork 级改动。

## 9. 决策点（待用户二选一）

- 选项 A（推荐）：默认 Canvas，WebGL 仅大输出 opt-in —— E1 已证明 Canvas 像素完美；策略层默认本就是 `terminalGpuAcceleration ?? false`，只需把 TerminalPanel 文案调回“Canvas 推荐”方向。改动 ≤2 文件。
- 选项 B：继续钻 WebGL —— 先跑运行时探针（devtools 片段，见 implement §5），再定是等上游/升 beta（当前 286/287，上游已到 300/304）还是立 fork 级任务。成本未定。
- 无论选哪个，本任务的乱码自愈部分（AC1/AC4/AC5）已达标可先合。
