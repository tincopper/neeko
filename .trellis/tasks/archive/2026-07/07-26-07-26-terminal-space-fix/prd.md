# 修复终端空格键在 IME 组字确认后丢失

## Goal

修复 Neeko 交互式终端中，使用中文（或其他 CJK）输入法时，按空格确认候选字后空格本身无法输入 PTY 的问题。同时保持现有中文输入防重复机制继续生效。

## Requirements

1. **空格可透传**：在终端获得焦点且未处于 IME 组字状态时，单独按下空格必须能正常发送到 PTY。
2. **IME 确认空格不丢失**：使用输入法（如 macOS/Windows 拼音、Rime、Fcitx 等）输入汉字并按空格确认候选后，空格字符必须能被发送到 PTY（若该 IME 设计就是把空格同时作为确认键和输入字符）。
3. **中文不重码**：继续使用 `compositionend` + `onData` 抑制机制，确保中文字符不会前后端各发一次导致重复显示。
4. **不影响 Ctrl+Enter / Alt+Enter**：多行输入的换行处理保持现状。
5. **不影响 Shift+符号 IME fallback**：Linux 下 Shift+数字/符号产生的中文标点补发逻辑保持现状。

## Acceptance Criteria

- [ ] 在终端中直接连续输入空格，光标正常右移，PTY 能收到空格（可用 `cat` 或 `showkey -a` 验证）。
- [ ] 在中文输入法状态下输入拼音并按空格选字后，紧接着再按一次空格，终端能显示空格且光标移动。
- [ ] 输入中文句子（多次组字、确认）不会出现字符重复显示。
- [ ] 单元测试覆盖：
  - [ ] 非 IME 空格正常转发；
  - [ ] `compositionend` 后仅抑制与组字结果相同的下一个 `onData`，不同内容（如空格）仍转发；
  - [ ] `compositionend` 后无后续 `onData` 时抑制状态正确清除。
- [ ] `pnpm lint`、`pnpm type-check`、`pnpm test:run` 通过。

## Notes

- 根因定位：`terminalInput.ts` 中 `compositionend` 把 `suppressNextOnData` 置为 `true`，并通过 `setTimeout(..., 0)` 清除，导致同一个事件循环里紧随其后的空格 `onData` 被丢弃。
- 参考历史文档：`docs/chinese-input-fix.md` 建议的修复方式是记录 `compositionPendingText`，仅在 `onData` 内容与 pending text 一致时抑制。
- 影响范围：仅 `src/features/terminal/components/terminalInput.ts` 及其测试文件。
