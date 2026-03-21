# Neeko - 多CLI Agent工具管理桌面应用

一款基于 Rust + Tauri 的跨平台桌面应用，用于统一管理多个 AI CLI Agent 工具。

## 功能特性

- 📁 **多项目管理** - 同时打开和管理多个项目
- 💻 **独立终端** - 每个项目绑定独立的终端会话
- 🤖 **多Agent支持** - 内置 opencode、claude code 等 Agent
- 🔀 **Git集成** - 分支展示、worktree 支持、diff 查看
- 📊 **状态标识** - 🟢空闲 / 🟡运行中 / 🔴失败
- 💾 **会话持久化** - 重启后恢复历史和状态

## 系统依赖

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install -y build-essential \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libgtk-3-dev \
  libwebkit2gtk-4.0-dev \
  libayatana-appindicator3-dev
```

### Fedora

```bash
sudo dnf install -y gcc gcc-c++ \
  webkit2gtk4.1-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel
```

### Arch Linux

```bash
sudo pacman -S base-devel \
  webkit2gtk-4.1 \
  libappindicator-gtk3 \
  librsvg
```

## 开发环境

### 前置要求

- Node.js 18+
- Rust 1.70+
- pnpm (推荐)

### 安装依赖

```bash
# 安装前端依赖
npm install

# 或使用 pnpm
pnpm install
```

### 运行开发模式

```bash
npm run tauri dev
```

### 构建

```bash
npm run tauri build
```

## 项目结构

```
neeko/
├── src/                    # 前端 React 代码
│   ├── components/         # React 组件
│   │   ├── ProjectSidebar.tsx
│   │   ├── TerminalView.tsx
│   │   ├── DiffView.tsx
│   │   └── AgentSelector.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── src-tauri/              # Rust 后端代码
│   ├── src/
│   │   ├── lib.rs          # Tauri 命令入口
│   │   ├── main.rs
│   │   ├── state.rs        # 数据结构定义
│   │   ├── git.rs          # Git 操作
│   │   ├── terminal.rs     # 终端管理
│   │   ├── agent.rs        # Agent 管理
│   │   ├── project.rs      # 项目管理
│   │   └── storage.rs      # 持久化存储
│   └── Cargo.toml
├── package.json
├── vite.config.ts
├── tsconfig.json
└── REQUIREMENTS.md         # 需求文档
```

## 技术栈

- **前端**: React 18 + TypeScript + Vite + xterm.js
- **后端**: Rust + Tauri 2.0
- **Git**: git2-rs
- **终端**: portable-pty
- **存储**: serde_json + 本地文件

## 配置目录

应用配置存储在 `~/.neeko/` 目录：

- `sessions.json` - 会话数据
- `config.json` - 用户配置

## 预设 Agent

| Agent | 命令 | 图标 |
|-------|------|------|
| opencode | `opencode` | 🤖 |
| claude-code | `claude` | 🧠 |
| cursor-agent | `cursor-agent` | 🖱️ |
| aider | `aider` | 💡 |

## License

MIT
