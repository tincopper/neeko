<div align="center">

# Neeko

**为 AI 编程时代打造的多项目终端管理器**

在同一个窗口里管理所有项目的 AI Agent 会话，让 opencode、claude-code 等工具触手可及。

[![Tauri](https://img.shields.io/badge/Tauri-2.0-blue?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.70+-orange?logo=rust)](https://rustup.rs)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)
[![License](https://img.shields.io/badge/License-Apache_2.0-green)](LICENSE)

**[English](README.md)** | 简体中文

</div>

---

## 这是什么

当你同时用 AI Agent 驱动多个项目时，反复在终端窗口间切换、重新启动 Agent、找回上下文，会打断开发节奏。

Neeko 把所有项目的 Agent 终端整合进一个桌面应用：左侧边栏管理项目与 Git 状态，右侧是每个项目的独立终端——切换项目，会话始终在线。

## 预览示例

| 主界面 | 副终端面板 |
|--------|-----------|
| ![主界面](docs/.img/index.png) | ![副终端面板](docs/.img/side-terminal.png) |

## 功能特性

- **多项目终端** — 每个项目绑定独立 PTY 终端，切换时会话不中断，无需重启 Agent
- **WSL 终端** — 浏览 WSL 发行版，选择路径，启动完整 PTY 终端并自动启动 Agent（仅 Windows）
- **SSH 远程终端** — 通过密码或密钥文件连接远程服务器，管理路径，远程运行 Agent，支持会话缓存；可选保存凭据以便无缝重连
- **Worktree 终端** — 每个 Git Worktree 拥有独立终端会话，自动进入正确的工作目录；点击侧边栏中的 Worktree 即可打开或恢复会话；支持 WSL 和 SSH 项目
- **Agent 一键启动** — 内置 opencode、claude-code、gemini、codex、qoder、codebuddy，选中即启动；Worktree 终端自动使用项目配置的 Agent
- **副终端面板** — `Ctrl+Alt+T` 在 Agent 终端旁打开独立副终端，宽度可拖拽调整；当 Worktree 终端激活时，副终端也在 Worktree 目录中打开
- **IDE 一键打开** — 为每个项目绑定 IDE，`Ctrl+O` 或点击图标即在 VSCode / Cursor / GoLand 等中打开项目；IDE 图标使用内置 SVG/PNG 资源
- **Git 侧边栏** — 以树形结构查看变更文件，切换分支，管理 Worktree，无需离开应用；文件变更自动刷新
- **Diff 查看** — 点击变更文件即可查看 Diff，支持统一/并排两种模式，语法高亮，词级 Diff，变更块导航
- **行内重命名** — 双击分支名或 Worktree 即可行内重命名，Enter 确认，Escape 取消
- **会话持久化** — 重启后自动恢复项目列表、Agent 和 IDE 配置；Worktree 终端状态在切换项目时按项目保存
- **终端刷新** — `Ctrl+R` 从缓存的 PTY 会话重建当前终端 DOM，不丢失状态
- **键盘驱动** — `Ctrl+1~9` 跳转项目，`Ctrl+Q` 循环切换，`Ctrl+N` 切换主终端和 Worktree 终端，`Ctrl+O` 打开 IDE
- **Shell 可配置** — 在设置中选择或自定义终端 Shell，支持 zsh / bash / fish / PowerShell 等
- **字体可配置** — 从系统字体中选择终端字体，实时预览
- **自定义 Agent** — 在设置面板中添加自定义 Agent CLI，或覆盖内置 Agent 命令
- **沉浸式界面** — One Dark Pro 配色，无系统边框，可拖拽调整边栏和副终端宽度

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

## 技术栈

| 层级 | 技术 |
|------|------|
| 应用框架 | Tauri 2.0 |
| 后端 | Rust + tokio + anyhow |
| 前端 | React 18 + TypeScript + Vite |
| 终端后端 | portable-pty |
| 终端前端 | @xterm/xterm 6 + @xterm/addon-fit |
| Git | git2-rs（libgit2 绑定） |
| SSH | russh（异步 SSH2 客户端） |
| 语法高亮 | highlight.js |
| 文件监听 | notify + notify-debouncer-mini |
| 对话框 | tauri-plugin-dialog |
| 序列化 | serde + serde_json |
| 系统调用 | libc（Unix PTY echo 控制） |
| 图标 | SVG（Simple Icons, Charm Icons） |
| 样式 | 纯 CSS，One Dark Pro 主题 |

## 预置 Agent

opencode, claude-code, gemini, codex, qoder, codebuddy

可在设置面板中添加自定义 Agent，或覆盖内置 Agent 命令。

## 预置 IDE

| ID | 名称 |
|----|------|
| `vscode` | VS Code |
| `cursor` | Cursor |
| `zed` | Zed |
| `idea` | IntelliJ IDEA |
| `goland` | GoLand |
| `rustrover` | RustRover |
| `pycharm` | PyCharm |

在设置面板中可覆盖每个 IDE 的启动命令，或添加自定义 IDE。

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+1` ~ `Ctrl+9` | 直接跳转到第 N 个项目 |
| `Ctrl+Q` | 循环切换到下一个项目 |
| `Ctrl+N` | 切换主终端和 Worktree 终端 |
| `Ctrl+Alt+T` | 打开副终端面板 |
| `Ctrl+W` | 关闭副终端面板 |
| `Ctrl+R` | 刷新/重建当前终端 |
| `Ctrl+O` | 在绑定 IDE 中打开当前项目 |

## License

Apache 2.0
