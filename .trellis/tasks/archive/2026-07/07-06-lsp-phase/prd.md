# Phase 1: LSP 代码跳转

## Goal

为 Neeko 的 CodeMirror 编辑器添加 LSP 驱动的代码智能能力：Go to Definition、Find References、Hover 信息、Diagnostics 内联展示、LSP 增强的自动补全。

## Requirements

### LSP 服务器管理

1. 后端按语言自动发现并启动 LSP server（rust-analyzer、pyright、typescript-language-server 等）
2. 生命周期与文件/项目绑定：打开文件时启动，关闭后终止
3. LSP server 异常退出后自动重启（最多 3 次）
4. LSP server 路径可由用户在 Settings 中配置

### Go to Definition

1. 编辑器右键菜单增加 "Go to Definition"（F12 快捷键）
2. 返回符号定义的位置（文件 + 行/列），编辑器跳转到目标位置
3. 跨文件跳转时自动打开目标文件

### Find References

1. 编辑器右键菜单增加 "Find References"（Shift+F12 快捷键）
2. 引用列表展示在右侧面板或弹窗中
3. 点击引用项跳转到对应位置

### Hover 信息

1. 鼠标在符号上悬停 300ms 后弹出工具提示
2. 显示类型签名、文档注释
3. 工具提示跟随鼠标位置，支持 Markdown 渲染

### Diagnostics 内联

1. LSP server 推送的 diagnostics 以波浪线样式渲染在编辑器文本上
2. gutter 区域显示错误/警告/信息图标
3. diagnostics 面板（侧边栏）展示当前文件的错误列表
4. 实时更新：文件修改后 diagnostics 自动更新

### 自动补全增强

1. 现有的 CodeMirror autocomplete 接入 LSP completion 源
2. LSP 补全优先级高于关键字/片段补全
3. 补全项附带类型标签和文档

## Acceptance Criteria

- [ ] `.rs` 文件打开后自动启动 rust-analyzer，编辑器底部状态栏显示 "LSP: rust-analyzer (已连接)"
- [ ] `.py` 文件打开后自动启动 pyright
- [ ] 在函数名上按 F12 跳转到函数定义（同文件）
- [ ] 在函数调用处按 F12 跳转到函数定义（跨文件）
- [ ] Shift+F12 展示引用列表，点击跳转
- [ ] 悬停在变量/函数上显示类型签名
- [ ] 语法错误以红色波浪线显示在编辑器（rust-analyzer 的诊断推送）
- [ ] 输入代码时自动补全下拉包含 LSP 建议
- [ ] 关闭所有 `.rs` 文件后 rust-analyzer 进程终止
- [ ] LSP server 崩溃后自动重启

## Out of Scope

- 代码重构（rename、code actions）—— 后续迭代
- 语法高亮 —— 已有 CodeMirror 实现
- WSL/SSH 远程的 LSP —— PRD 标注保留，Rust 端预埋框架
