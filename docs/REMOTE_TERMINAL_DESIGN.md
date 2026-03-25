# Neeko 远程终端设计方案

## 概述

本文档描述了 Neeko 终端系统的远程终端功能设计方案，包括 WSL 终端和 SSH 远程终端的支持。

## 需求总结

| 需求 | 选择 |
|------|------|
| WSL 支持平台 | ✅ 仅 Windows |
| 远程终端协议 | ✅ 仅 SSH |
| 配置持久化 | ✅ 是 |
| 实现优先级 | ✅ WSL 先，SSH 后 |
| WSL 结构 | ✅ 发行版 → 项目（两层） |
| SSH 结构 | ✅ 服务器 → 项目（两层） |
| 会话保持 | ✅ 支持，统一风格 |
| UI 设计 | ✅ 统一侧边栏，图标区分，可展开 |

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Neeko 终端系统 v2.0                         │
├─────────────────────────────────────────────────────────────────┤
│  前端 (React/TypeScript)                                        │
│  ├── TerminalView (本地终端) - 已有                              │
│  ├── WSLOpenView (WSL 终端) - 新增                              │
│  └── RemoteTerminalView (SSH 终端) - 新增                       │
├─────────────────────────────────────────────────────────────────┤
│  后端 (Rust)                                                    │
│  ├── TerminalManager (本地 PTY) - 已有                          │
│  ├── WSLTerminalManager (WSL) - 新增                            │
│  │   └── 通过 wsl.exe 启动 WSL 终端                             │
│  └── RemoteTerminalManager (SSH) - 新增                         │
│      └── 通过 SSH 连接远程服务器                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 统一的两层结构

```
本地项目：项目路径 → 终端会话
WSL：     发行版 → 项目路径 → 终端会话
SSH：     服务器 → 项目路径 → 终端会话

所有类型都支持：
✅ 会话保持
✅ 项目切换
✅ 配置持久化
```

## UI 设计

### 侧边栏布局

```
┌─────────────────────────────────────┐
│  终端                                │
├─────────────────────────────────────┤
│  📁 项目 A (本地)                    │  ← 本地项目（直接显示）
│  📁 项目 B (本地)                    │
│                                      │
│  🐧 Ubuntu (WSL)                    │  ← WSL 发行版（可展开）
│  │  📁 project-a                    │
│  │  📁 project-b                    │
│  🐧 Debian (WSL)                    │
│  │  📁 project-c                    │
│                                      │
│  🖥️ 192.168.1.100                    │  ← SSH 服务器（可展开）
│  │  📁 remote-project-a             │
│  │  📁 remote-project-b             │
│  🖥️ dev.example.com                  │
│  │  📁 remote-project-c             │
└─────────────────────────────────────┘
```

### 图标规则

| 类型 | 图标 | 示例 |
|------|------|------|
| 本地项目 | 📁 | 项目 A |
| WSL 发行版 | 🐧 | Ubuntu (WSL) |
| WSL 项目 | 📁 | project-a |
| SSH 服务器 | 🖥️ | 192.168.1.100 |
| SSH 项目 | 📁 | remote-project-a |

### 添加方式

```
┌─────────────────────────────────────┐
│  [+ 添加]  ← 点击后显示下拉菜单       │
├─────────────────────────────────────┤
│  📁 添加本地项目...                  │
│  🐧 添加 WSL 发行版...              │
│  🖥️ 添加远程服务器...               │
└─────────────────────────────────────┘
```

### 对话框设计

#### 添加 WSL 发行版

```
┌─────────────────────────────────────┐
│        添加 WSL 发行版               │
├─────────────────────────────────────┤
│  发行版: [Ubuntu ▼]                  │
│          ├── Ubuntu                  │
│          ├── Debian                  │
│          └── openSUSE-Leap           │
├─────────────────────────────────────┤
│         [取消]    [添加]             │
└─────────────────────────────────────┘
```

#### 在 WSL 下添加项目

```
┌─────────────────────────────────────┐
│        添加 WSL 项目                 │
├─────────────────────────────────────┤
│  发行版: Ubuntu (已选)               │
│  项目路径: [/home/user/project-a]    │
│  项目名称: [project-a]               │
├─────────────────────────────────────┤
│         [取消]    [添加]             │
└─────────────────────────────────────┘
```

#### 添加 SSH 服务器

```
┌─────────────────────────────────────┐
│        添加远程服务器                │
├─────────────────────────────────────┤
│  主机地址: [192.168.1.100]           │
│  端口:     [22____________]         │
│  用户名:   [root__________]         │
│  认证方式: ○ 密码  ○ 密钥文件       │
│  密码:     [••••••••______]         │
│  密钥路径: [________________] [浏览] │
├─────────────────────────────────────┤
│         [取消]    [连接]             │
└─────────────────────────────────────┘
```

#### 在 SSH 服务器下添加项目

```
┌─────────────────────────────────────┐
│        添加远程项目                  │
├─────────────────────────────────────┤
│  服务器: 192.168.1.100 (已选)        │
│  项目路径: [/home/user/project-a]    │
│  项目名称: [project-a]               │
├─────────────────────────────────────┤
│         [取消]    [添加]             │
└─────────────────────────────────────┘
```

## 数据结构

### 统一的终端项目类型

```rust
// 统一的终端项目类型
pub enum TerminalEntry {
    Local(Project),                  // 本地项目
    WSL {                            // WSL 项目
        distro: String,
        project: WSLProject,
    },
    Remote {                         // SSH 远程项目
        host: String,
        project: RemoteProject,
    },
}
```

### WSL 相关结构

```rust
// WSL 发行版
#[derive(Serialize, Deserialize, Clone)]
pub struct WSLEntry {
    pub id: String,
    pub distro: String,              // Ubuntu, Debian...
    pub projects: Vec<WSLProject>,
}

// WSL 项目
#[derive(Serialize, Deserialize, Clone)]
pub struct WSLProject {
    pub id: String,
    pub name: String,
    pub path: String,                // WSL 内路径
}
```

### SSH 相关结构

```rust
// SSH 服务器
#[derive(Serialize, Deserialize, Clone)]
pub struct RemoteEntry {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    pub projects: Vec<RemoteProject>,
}

// SSH 项目
#[derive(Serialize, Deserialize, Clone)]
pub struct RemoteProject {
    pub id: String,
    pub name: String,
    pub path: String,                // 远程路径
}

// 认证方式
#[derive(Serialize, Deserialize, Clone)]
pub enum AuthMethod {
    Password(String),
    KeyFile(String),
    KeyFileWithPassphrase { key_path: String, passphrase: String },
}
```

### 会话键规则

```rust
// 本地项目: "local:{project_id}"
// WSL 项目: "wsl:{distro}:{project_id}"
// SSH 项目: "ssh:{host}:{project_id}"
```

## 后端实现

### WSL 终端

#### 获取已安装的 WSL 发行版

```rust
#[tauri::command]
fn get_wsl_distros() -> Result<Vec<String>, String> {
    let output = std::process::Command::new("wsl.exe")
        .args(["-l", "-q"])
        .output()
        .map_err(|e| e.to_string())?;
    
    let distros: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.trim().to_string())
        .collect();
    
    Ok(distros)
}
```

#### 创建 WSL 终端会话

```rust
pub fn create_wsl_session(
    &self,
    distro: &str,
    project_path: &str,
    cols: u16,
    rows: u16,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;
    
    let mut cmd = CommandBuilder::new("wsl.exe");
    cmd.arg("-d").arg(distro);
    cmd.arg("--cd").arg(project_path);
    cmd.env("TERM", "xterm-256color");
    
    let child = pair.slave.spawn_command(cmd)?;
    // ... 其余逻辑与本地终端类似
}
```

### SSH 远程终端

#### 依赖库

```toml
# Cargo.toml
[dependencies]
russh = "0.40"  # 纯 Rust SSH 实现
russh-keys = "0.40"
tokio = { version = "1", features = ["full"] }
```

#### 创建 SSH 连接

```rust
pub async fn create_ssh_session(
    &self,
    connection: &RemoteEntry,
    project_path: &str,
    cols: u16,
    rows: u16,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession> {
    // 1. 建立 SSH 连接
    let session = ssh_connect(connection).await?;
    
    // 2. 打开 PTY 通道
    let channel = session.open_channel_pty(cols, rows, "xterm-256color").await?;
    
    // 3. 启动 shell 并切换到项目目录
    channel.exec(&format!("cd {} && bash", project_path)).await?;
    
    // ... 启动读写线程
}
```

## 前端实现

### 文件结构

```
src/
├── components/
│   ├── project/
│   │   └── ProjectSidebar.tsx   # 修改：添加 WSL/SSH 支持
│   ├── WSLDialog.tsx            # 新增：WSL 对话框
│   ├── RemoteDialog.tsx         # 新增：SSH 对话框
│   └── ...
├── types/
│   └── terminal.ts              # 新增：终端类型定义
└── App.tsx                      # 修改：集成新功能
```

### 类型定义

```typescript
// types/terminal.ts

export interface WSLEntry {
  id: string;
  distro: string;
  projects: WSLProject[];
}

export interface WSLProject {
  id: string;
  name: string;
  path: string;
}

export interface RemoteEntry {
  id: string;
  host: string;
  port: number;
  username: string;
  projects: RemoteProject[];
}

export interface RemoteProject {
  id: string;
  name: string;
  path: string;
}

export type TerminalEntry =
  | { type: 'local'; project: Project }
  | { type: 'wsl'; distro: string; project: WSLProject }
  | { type: 'remote'; host: string; project: RemoteProject };
```

## 配置持久化

### 存储结构

```rust
// storage.rs - 扩展

#[derive(Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub local_projects: Vec<Project>,
    pub wsl_entries: Vec<WSLEntry>,      // 新增
    pub remote_entries: Vec<RemoteEntry>, // 新增
    // ... 其他配置
}
```

### 存储位置

```
%APPDATA%/neeko/config.json (Windows)
~/.config/neeko/config.json (Linux/macOS)
```

## 实现步骤

### Phase 1: WSL 终端（先实现）

1. **后端**
   - [ ] 添加 WSL 发行版管理命令
   - [ ] 添加 WSL 项目管理命令
   - [ ] 实现 `create_wsl_session()`
   - [ ] WSL 配置持久化

2. **前端**
   - [ ] 创建 WSL 类型定义
   - [ ] 添加 WSL 发行版对话框
   - [ ] 添加 WSL 项目对话框
   - [ ] 修改侧边栏支持 WSL 展开
   - [ ] 终端会话保持和切换

### Phase 2: SSH 远程终端（后实现）

1. **后端**
   - [ ] 添加 russh 依赖
   - [ ] 实现 SSH 连接管理
   - [ ] 添加 SSH 服务器管理命令
   - [ ] 添加 SSH 项目管理命令
   - [ ] SSH 配置持久化（加密）

2. **前端**
   - [ ] 创建 SSH 类型定义
   - [ ] 添加 SSH 服务器对话框
   - [ ] 添加 SSH 项目对话框
   - [ ] 修改侧边栏支持 SSH 展开
   - [ ] 连接状态显示

## 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src-tauri/src/wsl.rs` | WSL 终端管理 |
| `src-tauri/src/remote.rs` | SSH 远程终端管理 |
| `src/components/WSLDialog.tsx` | WSL 对话框组件 |
| `src/components/RemoteDialog.tsx` | SSH 对话框组件 |
| `src/types/terminal.ts` | 终端类型定义 |

### 修改文件

| 文件 | 说明 |
|------|------|
| `src-tauri/Cargo.toml` | 添加 russh 依赖 |
| `src-tauri/src/lib.rs` | 添加新命令 |
| `src-tauri/src/state.rs` | 添加新数据结构 |
| `src-tauri/src/storage.rs` | 配置持久化扩展 |
| `src-tauri/src/terminal.rs` | 扩展终端管理器 |
| `src/components/project/ProjectSidebar.tsx` | 侧边栏扩展 |
| `src/App.tsx` | 集成新功能 |

## 注意事项

1. **WSL 仅支持 Windows**：需要在代码中添加平台检查
2. **SSH 密码安全**：密码需要加密存储，不建议明文
3. **连接超时**：SSH 连接需要设置合理的超时时间
4. **会话管理**：统一的会话键格式便于管理
5. **错误处理**：网络连接失败时的友好提示

## 参考资料

- [Tauri Plugin Dialog](https://v2.tauri.app/plugin/dialog/)
- [russh 文档](https://docs.rs/russh)
- [portable-pty 文档](https://docs.rs/portable-pty)
- [xterm.js 文档](https://xtermjs.org/)
