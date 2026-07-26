# 技术设计：修复终端空格键在 IME 组字确认后丢失

## 问题边界

仅涉及前端输入层 `src/features/terminal/components/terminalInput.ts`：

- `term.onData` 转发用户按键到 PTY。
- `compositionstart` / `compositionend` 处理 IME 组字，避免组字期间的中间字符被重复发送。
- `setupImeShiftSymbolFallback` 处理 Linux 下 Shift+符号产生中文标点的补发。
- `setupNewlineEnterHandler` 处理 Ctrl+Enter / Alt+Enter 多行输入。

后端 `terminal/services.rs` 与 Tauri 事件通道只透传字节，不参与逻辑，无需改动。

## 根因

当前实现：

```ts
compositionEndHandler = (e: CompositionEvent) => {
  composing = false;
  if (e.data) {
    sendInput(e.data);
  }
  suppressNextOnData = true;          // 无条件抑制下一个 onData
  setTimeout(() => {
    suppressNextOnData = false;
  }, 0);
};
```

在部分输入法/平台下，按空格确认候选字后，浏览器会在同一个事件循环内继续派发空格的 `input` 事件，xterm.js 随即触发 `onData(' ')`。由于 `suppressNextOnData` 仍为 `true`，空格被丢弃。

## 修复方案

采用 `docs/chinese-input-fix.md` 中建议的“pending text”精确抑制：

1. 新增状态 `compositionPendingText: string | null`。
2. `compositionend` 时：
   - 发送 `e.data`；
   - 设置 `compositionPendingText = e.data ?? null`；
   - 不再设置全局 `suppressNextOnData`。
3. `term.onData` 收到数据时：
   - 如果 `composing` 为 true，仍然跳过（组字期间不转发）。
   - 如果 `compositionPendingText` 非空且 `data === compositionPendingText`，说明这是 xterm.js 对组字结果的重复回调，清空 pending 并跳过。
   - 否则清空 pending 并正常转发。
4. 添加安全兜底：
   - 在 `compositionstart` 时清空 `compositionPendingText`；
   - 在 `dispose` 时清空。

### 伪代码

```ts
let compositionPendingText: string | null = null;

compositionStartHandler = () => {
  composing = true;
  compositionPendingText = null;
};

compositionEndHandler = (e: CompositionEvent) => {
  composing = false;
  const text = e.data;
  if (text) {
    compositionPendingText = text;
    sendInput(text);
  }
};

const disposable = term.onData((data) => {
  if (composing) return;
  if (compositionPendingText !== null) {
    if (data === compositionPendingText) {
      compositionPendingText = null;
      return;
    }
    compositionPendingText = null;
  }
  sendInput(data);
});
```

## 兼容性

- **纯英文输入**：`compositionPendingText` 始终为 `null`，逻辑与修改前完全一致。
- **中文组字**：`compositionend` 发送汉字，xterm.js 随后 `onData('中')` 与 pending 匹配，被抑制，避免重复。
- **空格确认**：若输入法把空格作为输入字符，`onData(' ')` 与 pending 汉字不匹配，正常转发。
- **多个 onData 包**：若 xterm.js 把组字结果和空格分两次回调，第一次匹配 pending 被抑制，第二次为空格正常转发。

## 测试策略

扩展 `src/features/terminal/components/__tests__/terminalInput.test.ts`：

1. 非 IME 空格：`dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))` + `emitData(' ')`，验证 `sendInput(' ')` 被调用。
2. `compositionend` 后空格：`fireCompositionEnd('中')` + `emitData(' ')`，验证 `sendInput` 被调用且参数为 `' '`，不被抑制。
3. `compositionend` 后重复汉字：`fireCompositionEnd('中')` + `emitData('中')`，验证 `sendInput` 只被调用一次（即 `sendInput('中')` 在 `compositionend` 时调用，`onData('中')` 被抑制）。

## 不改动范围

- `terminalFactory.ts`、`TerminalViewBase.tsx`、strategy 文件：创建/销毁、session 管理、输出过滤逻辑不变。
- Rust 后端：只透传字节，不改动。
- 全局快捷键、Task Console、编辑器：与本次根因无关，不改动。
