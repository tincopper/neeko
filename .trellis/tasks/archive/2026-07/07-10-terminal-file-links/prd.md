# PRD: 终端文件路径点击跳转

## 需求

在终端 Tab 页面中，当输出内容包含文件路径（如 `src/main.rs:10:5`、`/abs/path/file.ts:42`）时：
- **单击**：在系统文件管理器中显示该文件（保持现有行为）
- **Ctrl/Cmd + 单击**：在编辑器新 Tab 中打开文件，并跳转到对应行/列

## 验收标准

1. 单击文件路径 → 在 Finder/Explorer 中 `reveal_in_file_manager`
2. Cmd/Ctrl + 单击文件路径 → 编辑器新 Tab 打开文件，光标跳转对应行列
3. 支持路径格式：
   - 绝对路径：`/home/user/project/src/main.rs:10:5`
   - 相对路径：`src/main.rs:10:5`、`./src/lib.rs:42`
   - 跨平台 Windows 路径：`C:\Users\...\file.ts:10:5`
4. 支持 WSL 和 Remote 终端（通过各自 transport 读取文件）
5. 已打开的 Tab 复用现有 Tab 并导航，不重复创建
6. 不符合文件路径的不触发（保留现有 WebLinksAddon 行为）

## 约束

- 不改动 `TerminalViewBase.tsx`
- 不改动 `editorStore.ts`
- 不改动 `TerminalStrategy` 接口签名
