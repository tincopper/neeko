# 实施计划：浏览器元素选择器与 AI 输入框优化（支持多选）

> 复杂任务。落地前先 `task.py start`，按序执行，每个阶段跑对应验证命令。

## 阶段 0：基线

- [ ] 确认当前工作树干净、`main` 最新（`git status`）。
- [ ] 运行回归基线：`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm test:run`、`pnpm type-check`，确认通过后再动手。

## 阶段 1：协议层（Rust）— Breaking Change

> 改动文件：`src-tauri/src/browser/uri_scheme.rs`、`src-tauri/src/browser/commands.rs`（不动）、`src-tauri/src/browser/events.rs`（不动）

- [ ] 定义 `PickerElement { html, selector }`（`serde` 派生）。
- [ ] `PickerMessage::PromptSubmitted` 改为 `{ prompt, elements: Vec<PickerElement> }`。
- [ ] `parse_picker_payload`：解析 `elements` 数组；缺失/空/元素缺 `html` → `None`。
- [ ] `handle_picker_message`：emit payload `{ prompt, elements }`。
- [ ] **测试先行（TDD）**：新增/更新 `uri_scheme.rs` 单测 —— 数组解析 ✓、空数组 ✗、缺 html ✗、去重窗口、其余消息不变。
- [ ] 验证：`cargo test --manifest-path src-tauri/Cargo.toml`。

## 阶段 2：注入脚本 `picker_script.js`（核心 UX）

> 改动文件：`src-tauri/src/browser/picker_script.js`；主题色复用 `__NEEKO_THEME__`

- [ ] 状态模型：`S.mode` / `S.selectedEl` / `S.multiSel` / rAF。
- [ ] Phase 1 升级：hover 高亮（dashed + 光晕）、tooltip chip、rAF 节流、顶部 Pill（**纯被动指示**，不含切换按钮）。
- [ ] 选中锁定：四角徽标 + `#selBar`（Parent/Child/Copy HTML）。
- [ ] 多选：`toggleMulti` 编号徽标 + Composer 内嵌 chips（`renderChips`/`currentElements`/`removeChip`，**无独立托盘**）；首个选中即开 Composer。
- [ ] Composer：底部居中、元素上下文（单选 1 chip / 多选 N chips）、发送按钮、快捷键、成功反馈；**单颗 `⇄ Single/Multi` 药丸开关**（Composer 底部，单→多携带/多→单提升，不丢输入）。
- [ ] 交互规则落地：`onClick` 对覆盖层 `isUIEl` 直接 return（**不 stopPropagation**）；发送后立即清理；scroll 跟随；Esc/✕ 语义（多选清空并关闭）；「是否打开」判断用正向谓词 `display === 'flex'`（jsdom cssText 解析限制）。
- [ ] 文案英文（与已批准原型一致）；验证：`node --check` + `pnpm lint`（Rust fmt/clippy 若涉及）+ jsdom 注入测试 `pickerScript.test.ts` + 手动用原型清单回归（`browser-picker-prototype.html`）。

## 阶段 3：前端编排

> 改动文件：`src/features/browser/hooks/useBrowserPanel.ts`、`src/features/browser/components/pickerUtils.ts`、`src/features/browser/api/browserApi.ts`（不动）

- [ ] `PromptSubmittedPayload` → `{ prompt, elements: PickerElement[] }`；`PickerElement` 类型落 `src/shared/types/`（或 feature types）。
- [ ] `formatPickerMessage(prompt, elements, url)` 重写：多元素编号 + selector + 双代码块。
- [ ] **测试先行**：更新 `pickerUtils.test.ts`（多元素输出/selector 边界），补充 `useBrowserPanel` 行为测试（mock invoke + 事件）。
- [ ] 验证：`pnpm test:run`、`pnpm type-check`、`pnpm lint:fe`。

## 阶段 4：主题与一致性

- [ ] `PickerThemeColors` 按需扩展（若 Composer 需要额外色 token）；`getThemeColors` 默认值补全。
- [ ] 检查事件名仍走 `src/shared/events.ts` 常量（Event 名常量化红线）。
- [ ] 确认 `neeko_invoke_handler!` 命令清单无新增命令需求。

## 阶段 5：集成与回归

- [ ] 全量验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm test:run`、`pnpm type-check`、`pnpm lint`、`pnpm lint:fe`。
- [ ] 手动回归清单（对照 PRD Acceptance Criteria）：
  - [ ] 单选：hover/锁定/父级/子级/复制/Esc。
  - [ ] 多选：累加编号/取消/chips 移除/药丸开关携带与提升/清空并关闭。
  - [ ] 多选发送 → Agent CLI 收到含全部元素 HTML 的消息；发送后立即清理、新一轮计数稳定。
  - [ ] 未选中 Agent CLI tab 时 toast 提示 + picker 重新注入。
  - [ ] 页面刷新/导航后 picker 重新注入（既有 reinject 机制）。

## 阶段 6：收尾

- [ ] 同步必要 spec（`docs/neeko-development-spec.md` 或 `.trellis/spec/` 若涉及浏览器协议约定）。
- [ ] `task.py validate <task>` 通过。
- [ ] 提交代码（原子化：协议+脚本+前端+测试一个 commit 或按阶段拆），`task.py set-branch`/`archive` 按流程执行。
- [ ] 执行会话记录：`python3 ./.trellis/scripts/add_session.py --title "..." --commit "<hash>"`。

## 回滚点

- 阶段 1 前：`git stash` 即可回退（协议未动）。
- 阶段 2/3：协议与前端同 commit 原子升级，回滚需一起 revert。
