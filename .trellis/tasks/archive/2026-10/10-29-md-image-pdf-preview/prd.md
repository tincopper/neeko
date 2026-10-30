# Markdown 图片渲染与 PDF 预览

## Goal

修复 Markdown 图片渲染（png/webp 等，含远程项目），新增 PDF 文件打开预览能力。

## Background

当前 Markdown 渲染（`src/ui/MarkdownPreview.tsx` 的 `ImageBlock`）与图片文件预览
（`src/features/editor/components/ImageFileView.tsx`）只在「本地项目 + 正确 basePath」
这一条路径上可用；agent-chat 消息、会话消息、PR 描述中的图片完全不渲染，
SSH/WSL 远程项目的图片全部加载失败。PDF 打开后落入二进制兜底视图
（"Binary file — cannot be displayed"），无任何预览能力。

## Requirements

### R1 Markdown 图片渲染（全部渲染点）

- R1.1 Markdown 中的图片在以下渲染点均可显示：
  - 文件编辑器 Markdown 预览（`FileEditorView`）
  - agent-chat 消息（`features/agent-chat/components/MessageContent.tsx`）
  - 会话消息（`features/conversation/components/MessageBlocks.tsx`）
  - PR 描述（`features/git/components/pr-detail/PRDescription.tsx`）
  - Skill 查看对话框（`features/skill/components/ViewSkillDialog.tsx`，现状已可用，不得回归）
- R1.2 支持的图片来源：相对路径（相对 md 文件所在目录）、绝对路径、`http(s)://`、
  `data:` URI、`blob:`；格式 png / jpg / jpeg / gif / webp / bmp / avif / ico / svg。
- R1.3 图片加载失败时显示可读的兜底（alt 或文件名），不渲染破图占位。
- R1.4 本地项目与 SSH/WSL 远程项目均适用。

### R2 PDF 打开预览

- R2.1 文件编辑器打开 `.pdf` 文件时显示 PDF 预览（而非 "Binary file" 兜底）。
- R2.2 浏览模式：**连续滚动**（默认）与**单页翻页**两种模式可切换；均支持缩放、页码跳转、
  键盘翻页（←/→）；连续滚动模式按需渲染可视页（虚拟化，不一次性渲染全部页面）。
- R2.3 本地项目与远程项目均适用；损坏文件 / 读取失败显示明确错误信息。
- R2.4 PDF 字节不进 JSON 序列化（红线 4）；**大文件按需分片加载**（range 读取，
  不一次性载入整个文件），支持浏览远超内存舒适区的 PDF；单次分片载荷有上界防护。

### R3 通道统一（工程约束，非用户可见）

- R3.1 「路径 → 可渲染 URL」收敛为单一解析入口，渲染点禁止各自手写路径归一。
- R3.2 二进制字节读取收敛为单一后端通道，Local / WSL / SSH 三环境同构，且支持
  **按偏移量的 range 读取**（小文件整读与大文件分片共用同一入口）。

## Constraints

- 红线 1/2（命令统一走 `core::exec` / `common::executor`，远程读取不直接 `std::process`）；
- 红线 3（Local fs 读取包 `spawn_blocking`）；
- 红线 4（单次 Command JSON ≤ 2MB，二进制载荷走 `tauri::ipc::Response::new(Vec<u8>)`）；
- 红线 6（command 层只做校验 + 调度）；
- 红线 8（前端传入路径消费前 `canonicalize` + scope 校验）；
- 红线 13（测试夹具路径由 `tempdir()` 推导）；
- TDD 强制：先写失败测试再实现；纯函数 100% 覆盖。
- 新增前端依赖仅允许 `pdfjs-dist`（PDF 解码），其余用现有依赖。

## Acceptance Criteria

- [x] AC1 本地项目 `.md` 预览中，相对/绝对路径的 png/webp 等图片正常显示，点击放大；
      `data:` URI 图片在传入 basePath 的渲染点不被破坏。
      （用户实测确认；关键阻塞项是 asset 协议 dotfile 403，非路径解析）
- [x] AC2 agent-chat 消息、会话消息、PR 描述中的 Markdown 图片正常显示（相对路径以项目根解析）。
      （`img` 组件映射 + basePath 回落 Workspace 根；组件测试覆盖解析结果）
- [x] AC3 SSH/WSL 远程项目的 Markdown 图片与图片文件预览正常显示。
      （`read_file_bytes` → blob 通道；单测覆盖通道选择与 revoke。远程真机未逐一人工回归）
- [x] AC4 本地与远程项目打开 `.pdf` 显示预览，支持连续滚动与单页翻页两种模式、缩放与页码跳转；
      损坏 PDF 显示错误提示。（9 条组件测试覆盖两模式/缩放/翻页/键盘/损坏与空文件；
      `vite build` 已验证 pdf.js 懒加载与 worker 产物）
- [x] AC5 二进制载荷（图片/PDF 字节）不出现在任何 Command 的 JSON 返回中
      （走 `Response::new(Vec<u8>)` 二进制流，有测试或审查证据）。
      `read_file_bytes` / `read_file_size` 两条命令均返回 `Response`/`u64`，无 JSON 字节数组。
- [~] AC6 大 PDF（≥ 200MB）以分片方式按需加载、可滚动浏览，全程不整读文件、
      前端内存有界（虚拟化只渲染可视页）；读取失败/损坏显示明确报错而非崩溃/卡死。
      机制已由测试钉住（`disableAutoFetch` + range transport + 单分片 1MB 裁切 + 虚拟化窗口）；
      **≥200MB 真机大文件浏览仍待人工验收**（未在本轮验证路径内）。
- [x] AC7 `pnpm check:quick` 全绿（34 条护栏）；既有 MarkdownPreview / ImageFileView 测试不回归。
      `cargo test --lib` 2260 passed；`npx vite build` 通过。

## Out of Scope

- PDF 文本选择 / 复制 / 打印 / 表单填写。
- 图片文件的编辑（裁剪、标注）。
- 音视频预览。
- assetProtocol scope 收紧（`**` → 白名单）——识别为既有加固项，单独立项。
  本轮只修了 dotfile 语义（`requireLiteralLeadingDot: false`），`allow` 仍是 `**`。
