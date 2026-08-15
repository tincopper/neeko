# 优化浏览器元素选择器与 AI 输入框（支持多选）

## Goal

优化 Neeko 内置浏览器的元素选择器体验：1) 提升选取交互（高亮、模式指示、选中态、父/子级微调、滚动跟随、性能）；2) 重做选取后弹出的 AI 输入框（底部 Composer，更美观、带元素上下文、可发现性强的发送按钮）；3) **支持一次选择多个元素**，对多个元素一次性生成修改需求。

原型：`./browser-picker-prototype.html`（本目录，可交互演示）。

## Requirements

### R1. 元素选择器（Phase 1）
- [x] 高亮升级：虚线外框 + accent 光晕 + 半透明着色，任意页面背景下清晰可见；`mousemove` 用 rAF 节流。
- [x] **选中锁定态**：点击后元素保持实线高亮 + 四角徽标（左上 tag、右下尺寸），不再点击即消失。
- [x] 选中快捷操作条：`↖ 父级` / `↘ 子级` / `⧉ 复制 HTML`，支持微调选取范围。
- [x] 顶部模式指示 Pill：`● 元素选择中 — 点击选取 · Esc 退出`，始终提示当前模式。
- [x] 滚动跟随：页面滚动时徽标/操作条重算位置，滚出视口自动清除选中。
- [x] Tooltip 升级为 chip（tag + selector + 尺寸 + 操作提示），视口边缘自动翻转。
- [x] 忽略不可选取元素：`documentElement` / `body` / 选择器自身覆盖层。

### R2. 多选支持
- [x] 单选 / 多选两种模式，用 Composer 底部**单颗 `⇄ Single/Multi` 药丸开关**切换（顶部 Pill 仅被动指示；原型迭代决定：原为顶部 seg）。
- [x] 多选：点击累加选中（带编号徽标 ①②③，按点击顺序）；再次点击取消；已选元素悬停不叠加 hover 高亮。
- [x] 多选元素以 **chips 内嵌 Composer 输入区上方**显示（编号 + selector + 尺寸 + ✕ 单移），实时更新，**无独立托盘**（原型迭代决定）。
- [x] **首个选中即打开 Composer**，一次针对全部所选元素生成需求（无托盘「完成 →」步骤；原型迭代决定）。
- [x] 模式切换时：单→多携带当前元素为第 1 个、多→单提升最后一个，不丢已输入内容；发送后立即清理选中（无延迟回调竞态）。

> UX 迭代记录：原型评审后，多选由「独立底部托盘 + 清空/完成」改为「chips 直接内嵌输入区上方」；模式切换由顶部 seg 改为 Composer 底部单颗药丸开关；全量文案英文（用户确认）。

### R3. AI 输入框（Phase 2 — Composer）
- [x] 底部居中浮层（对齐主流 AI 产品交互），`backdrop-blur` + accent 描边 + 大阴影。
- [x] Composer 顶部 chips 行：单选 1 个 / 多选 N 个，每 chip = 编号 + selector + 尺寸 + ✕ 单移；无独立上下文单行。
- [x] 显式 `Send` 按钮（accent + 纸飞机），随内容启用/禁用；文本域自动增高。
- [x] 底部快捷键提示（英文）：`Enter send · Shift+Enter newline · Esc cancel`。
- [x] 关闭语义：单选下 ✕/Esc 只关输入框回到选取；**多选下 ✕/Esc 清空选择并关闭**（避免关掉后无法重新打开的死路）。
- [x] 发送后成功反馈 pill。

### R4. 协议与数据流（落地产品代码时）
- [x] `neeko://` 协议 `PromptSubmitted` 消息体从单 `html` 扩展为元素数组 `elements: [{ html, selector }]`。
- [x] `parse_picker_payload` / `handle_picker_message` / `formatPickerMessage` / 前端 `PromptSubmittedPayload` 同步升级（Breaking Change）。
- [x] 保持「未选中 Agent CLI tab 时提示并重新注入」的既有守卫。
- [x] 主题色映射 `PickerThemeColors` 复用现有 6 个 token（Composer 未引入新颜色，无需扩展）。

## Acceptance Criteria

- [ ] 单选模式下：hover 高亮清晰、点击锁定（角标 + 操作条）、可父/子级微调、Esc 退出。
- [ ] 多选模式下：点击累加带编号、再次点击取消、chips 实时累计且可单项移除/清空（✕/Esc 清空并关闭）。
- [ ] 多选完成后发送，一次生成覆盖全部所选元素的修改需求（消息含每个元素 HTML）。
- [ ] 发送后立即清理选中态，新一轮选取计数从 0 稳定递增（无 1.5s 竞态问题）。
- [ ] Composer 在任何模式都显示正确的元素上下文，快捷键符合提示文案。
- [ ] Rust 协议解析有单测覆盖：数组消息解析、缺字段拒绝、去重窗口；前端 `pickerUtils` 测试同步更新。
- [ ] `pnpm type-check` / `pnpm test:run` / `cargo test` 全部通过。

## Notes

- 注入脚本为自包含 IIFE，直接在任意网页运行，改动需同时考虑 shadow DOM / iframe / 滚动 / z-index / 事件捕获边界。
- `formatPickerMessage` 生成发给 Agent CLI 的文本，多选时需把每个元素的 outerHTML 都嵌入。
- 原型已在本目录维护；落地时以产品代码为准，原型仅作交互参照。
