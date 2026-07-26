# 执行计划：修复终端空格键在 IME 组字确认后丢失

## 变更清单

1. `src/features/terminal/components/terminalInput.ts` —— 核心修复
2. `src/features/terminal/components/__tests__/terminalInput.test.ts` —— 补回归测试

## 步骤

### 1. 修改 `terminalInput.ts`

- [ ] 在 `setupTerminalInput` 内新增 `let compositionPendingText: string | null = null;`。
- [ ] 修改 `compositionStartHandler`：
  - `composing = true;`
  - `compositionPendingText = null;`
- [ ] 修改 `compositionEndHandler`：
  - 保留 `composing = false;`
  - 发送 `e.data`（若存在）；
  - 设置 `compositionPendingText = e.data ?? null;`
  - 删除 `suppressNextOnData` 及其 `setTimeout`。
- [ ] 修改 `term.onData` 回调：
  - 保留 `if (composing) return;`
  - 新增 pending text 匹配逻辑：
    - 若 `compositionPendingText !== null` 且 `data === compositionPendingText`，清空 pending 并 `return`；
    - 若 `compositionPendingText !== null` 但 `data !== compositionPendingText`，清空 pending 并继续转发。
- [ ] 修改 `dispose`：
  - 删除 `suppressNextOnData = false;`
  - 新增 `compositionPendingText = null;`

### 2. 补测试

- [ ] 新增测试：普通空格正常转发。
- [ ] 新增测试：`compositionend('中')` 后 `emitData(' ')` 正常转发空格。
- [ ] 新增测试：`compositionend('中')` 后 `emitData('中')` 被抑制，保证 `sendInput` 总共只调用一次。
- [ ] 运行 `pnpm test src/features/terminal/components/__tests__/terminalInput.test.ts --run` 确认通过。

### 3. 质量检查

- [ ] `pnpm lint`
- [ ] `pnpm type-check`
- [ ] `pnpm test:run`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`

### 4. 验证

- [ ] 在 `pnpm tauri dev` 中打开终端，直接连续输入空格验证光标移动。
- [ ] 切换到中文输入法，输入拼音并按空格选字，再按空格验证空格输入。
- [ ] 输入一段中文验证无重复。

## 回滚点

若修复导致中文重复显示，立即回滚到 `terminalInput.ts` 的修改前版本，并恢复 `suppressNextOnData` 方案。
