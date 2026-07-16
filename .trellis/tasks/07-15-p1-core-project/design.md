# P1 Design: 后端 core 模块

## 模块结构

```
src-tauri/src/core/
├── mod.rs          # 模块入口，pub mod project; pub use project::*;
└── project.rs      # Project + ProjectEnvironment + ViewMode
```

## ProjectEnvironment 定义

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProjectEnvironment {
    Local,
    #[cfg(target_os = "windows")]
    Wsl { distro: String },
    Remote {
        host: String,
        port: u16,
        username: String,
        auth: crate::common::connection::types::AuthMethod,
    },
}

impl ProjectEnvironment {
    /// 将 environment 转换为 GitTransport，供 git 操作使用
    pub fn to_git_transport(&self, project_path: &str) -> (crate::common::git::transport::GitTransport, &str) {
        match self {
            Self::Local => (crate::common::git::transport::GitTransport::Local, project_path),
            #[cfg(target_os = "windows")]
            Self::Wsl { distro } => (
                crate::common::git::transport::GitTransport::Wsl { distro: distro.clone() },
                project_path,
            ),
            Self::Remote { host, port, username, auth } => (
                crate::common::git::transport::GitTransport::Remote {
                    host: host.clone(),
                    port: *port,
                    username: username.clone(),
                    auth: auth.clone(),
                },
                project_path,
            ),
        }
    }

    /// 转换为 ExecTarget，供 shell 命令执行
    pub fn to_exec_target(&self) -> crate::common::executor::factory::ExecTarget {
        match self {
            Self::Local => crate::common::executor::factory::ExecTarget::Local,
            #[cfg(target_os = "windows")]
            Self::Wsl { distro } => crate::common::executor::factory::ExecTarget::Wsl { distro: distro.clone() },
            Self::Remote { host, port, username, auth } => crate::common::executor::factory::ExecTarget::Remote {
                host: host.clone(),
                port: *port,
                username: username.clone(),
                auth: auth.clone(),
            },
        }
    }
}
```

## Project 定义（迁移后）

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    #[serde(default)]  // 旧 session 无 environment 时降级为 Local
    pub environment: ProjectEnvironment,
    pub git_info: Option<GitInfo>,
    pub terminal: TerminalSession,
    pub selected_agent: Option<String>,
    pub selected_ide: Option<String>,
    pub active_view: ViewMode,
    pub collapsed: bool,
    #[serde(default)]
    pub avatar_color: Option<String>,
}
```

## 向后兼容

`#[serde(default)]` 确保从旧 `session.json` 反序列化时，缺失的 `environment` 字段使用 `ProjectEnvironment::default()`（即 `Local`）。由于 WSL/Remote 项目之前不存储在 `ProjectManager` 中，只有旧 local 项目会走这个回退——这是正确的。

## 迁移路径

1. 创建 `core/mod.rs` + `core/project.rs`
2. 从 `project/model.rs` 复制 `Project` + `ViewMode`（去掉 `pub use crate::common::types::*`）
3. 追加 `environment: ProjectEnvironment` 字段
4. `project/model.rs` 删除 `Project`/`ViewMode`（仅保留 git/PR 类型）
5. `project/types.rs` 改为 `pub use crate::core::*;`
6. 全局替换 `crate::project::model::Project` → `crate::core::Project`
7. 全局替换 `crate::project::model::ViewMode` → `crate::core::ViewMode`

## 依赖

- `crate::common::connection::types::AuthMethod`（Remote variant 需要）
- `crate::common::terminal::types::TerminalSession`（Project 需要）
- `crate::common::types::GitInfo`（Project 需要）
