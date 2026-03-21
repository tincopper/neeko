<div align="center">

# Neeko

**为 AI 编程时代打造的多项目终端管理器**

在同一个窗口里管理所有项目的 AI Agent 会话，让 opencode、claude-code、aider 等工具触手可及。

[![Tauri](https://img.shields.io/badge/Tauri-2.0-blue?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.70+-orange?logo=rust)](https://rustup.rs)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)
[![License](https://img.shields.io/badge/License-Apache_2.0-green)](LICENSE)

</div>

---

## 这是什么

当你同时用 AI Agent 驱动多个项目时，反复在终端窗口间切换、重新启动 Agent、找回上下文，会打断开发节奏。

Neeko 把所有项目的 Agent 终端整合进一个桌面应用：左侧边栏管理项目与 Git 状态，右侧是每个项目的独立终端——切换项目，会话始终在线。

## 功能特性

- **多项目终端** — 每个项目绑定独立 PTY 终端，切换时会话不中断，无需重启 Agent
- **Agent 一键启动** — 内置 opencode、claude-code、aider、qwen、gemini、codex，选中即启动
- **Git 侧边栏** — 查看变更文件、切换分支、管理 Worktree，无需离开应用
- **Diff 查看** — 点击变更文件即可查看 Diff，支持统一/并排两种模式
- **会话持久化** — 重启后自动恢复项目列表与 Agent 配置
- **键盘驱动** — `Ctrl+1~9` 跳转项目，`Ctrl+Q` 循环切换，不打断键盘流
- **沉浸式界面** — One Dark Pro 配色，无系统边框，边栏宽度可拖拽调整

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.70+
- [pnpm](https://pnpm.io/)（推荐）

### Linux 系统依赖

**Ubuntu / Debian**
```bash
sudo apt install -y build-essential libwebkit2gtk-4.1-dev \
  libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev
```

**Fedora**
```bash
sudo dnf install -y gcc gcc-c++ webkit2gtk4.1-devel \
  libappindicator-gtk3-devel librsvg2-devel
```

**Arch Linux**
```bash
sudo pacman -S base-devel webkit2gtk-4.1 libappindicator-gtk3 librsvg
```

### 安装与运行

```bash
# 安装前端依赖
pnpm install

# 开发模式
pnpm tauri dev

# 构建发行版
pnpm tauri build
```

## 项目结构

```
neeko/
├── src/                          # 前端 React 代码
│   ├── App.tsx                   # 根组件，统一标题栏，全局状态
│   ├── types.ts                  # TypeScript 类型定义
│   ├── styles.css                # 全局样式（One Dark Pro 主题）
│   ├── utils/
│   │   └── fileIcons.ts          # 文件名 → Charmed Icons SVG 映射
│   └── components/
│       ├── AgentSelector.tsx     # Agent 选择下拉
│       ├── DiffView.tsx          # Diff 视图（统一/并排）
│       ├── SettingsPanel.tsx     # 浮动设置面板
│       ├── TerminalView.tsx      # xterm.js 终端 + 会话缓存
│       ├── WindowControls.tsx    # 最小化/最大化/关闭按钮
│       └── project/
│           ├── ProjectSidebar.tsx  # 可拖拽宽度边栏
│           ├── ProjectItem.tsx     # 项目行（分支/Worktree/文件）
│           ├── FileTree.tsx        # 递归文件树
│           └── GitDialog.tsx       # 新建分支/Worktree 对话框
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs               # Tauri 命令入口（29个命令）
│   │   ├── state.rs             # Rust 数据结构
│   │   ├── agent.rs             # AgentManager + 预置 Agent
│   │   ├── project.rs           # ProjectManager
│   │   ├── git.rs               # git2-rs Git 操作 + Diff
│   │   ├── terminal.rs          # portable-pty PTY 管理
│   │   └── storage.rs           # ~/.neeko/ JSON 持久化
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/
│   └── icons/                   # Charmed Icons SVG 文件
└── REQUIREMENTS.md
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 应用框架 | Tauri 2.0 |
| 后端 | Rust + tokio + anyhow |
| 前端 | React 18 + TypeScript + Vite |
| 终端后端 | portable-pty |
| 终端前端 | xterm.js 5 + xterm-addon-fit |
| Git | git2-rs（libgit2 绑定） |
| 对话框 | tauri-plugin-dialog |
| 序列化 | serde + serde_json |
| 图标 | Charmed Icons SVG |
| 样式 | 纯 CSS，One Dark Pro 主题 |

## 预置 Agent

| ID | 命令 | 图标 |
|----|------|------|
| `opencode` | `opencode` | 🤖 |
| `claude-code` | `claude` | 🧠 |
| `aider` | `aider` | 💡 |
| `qwen` | `qwen` | 🌟 |
| `gemini` | `gemini` | ♊ |
| `codex` | `codex` | ⚡ |

通过 `add_agent` 命令可在运行时注册自定义 Agent。

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+1` ~ `Ctrl+9` | 直接跳转到第 N 个项目 |
| `Ctrl+Q` | 循环切换到下一个项目 |

## License

Apache 2.0
