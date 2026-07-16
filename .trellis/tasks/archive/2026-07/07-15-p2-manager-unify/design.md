# P2 Design: ProjectManager 统一

## ProjectManager 扩展

```rust
pub struct ProjectManager {
    projects: Vec<Project>,    // ← 现在包含所有类型
    persist: Box<dyn Fn(&[Project]) + Send>,
}
```

新增方法：
```rust
impl ProjectManager {
    /// 添加 WSL 项目（从 session 恢复/新建）
    pub fn add_wsl_project(
        &mut self,
        id: String,
        name: String,
        path: PathBuf,
        distro: String,
        agent: Option<String>,
        ide: Option<String>,
        avatar_color: Option<String>,
    ) -> Project;

    /// 添加 Remote 项目（从 session 恢复/新建）
    pub fn add_remote_project(
        &mut self,
        id: String,
        name: String,
        path: PathBuf,
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
        agent: Option<String>,
        ide: Option<String>,
        avatar_color: Option<String>,
    ) -> Project;
}
```

## Session 加载适配（`session/manager.rs`）

现有流程：
```
SessionStore.load()
  → projects[] → ProjectManager.add_project_from_session()
  → wsl_entries → (currently ignored by ProjectManager)
  → remote_entries → (currently ignored by ProjectManager)
```

新流程：
```
SessionStore.load()
  → projects[] → ProjectManager.add_project_from_session()  [environment: Local]
  → wsl_entries → 遍历 → ProjectManager.add_wsl_project()    [environment: Wsl { distro }]
  → remote_entries → 遍历 → ProjectManager.add_remote_project() [environment: Remote { ... }]
```

**关键点**：WSLProjectSession 和 RemoteProjectSession 在 session 恢复中本就有自己的 id，直接复用这些 id 作为 Project.id。

## Session 保存适配

当前 `session/commands.rs` 中 `save_session` 命令收集数据的方式需要分流。

伪代码：
```rust
fn collect_wsl_projects(manager: &ProjectManager) -> Vec<WSLEntrySession> {
    // 筛选 environment: Wsl 的项目，按 distro 分组为 WSLEntrySession
}

fn collect_remote_projects(manager: &ProjectManager) -> Vec<RemoteEntrySession> {
    // 筛选 environment: Remote 的项目，按 host 分组为 RemoteEntrySession
}
```

调用链：
```
save_session:
  let local = manager.projects.iter().filter(|p| matches!(p.environment, Local));
  let wsl = collect_wsl_projects(&manager);
  let remote = collect_remote_projects(&manager);
  
  SessionStore {
      projects: local.map(to_project_session).collect(),
      wsl_entries: wsl,
      remote_entries: remote,
      ...
  }
```

## AppStateWrapper::resolve_project

```rust
impl AppStateWrapper {
    pub fn resolve_project(&self, project_id: &str) -> Result<(GitTransport, String), AppError> {
        let manager = self.project_manager.lock().map_err(AppError::from)?;
        let project = manager.get_project(project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
        
        let path = project.path.to_string_lossy().to_string();
        let transport = project.environment.to_git_transport(&path);
        
        Ok(transport)
    }
}
```

## 向后兼容

- 磁盘格式不变 → 旧 session.json 直接读入
- `serde(default)` 在 P1 已添加到 `environment`，旧 local 项目 `environment` 默认为 `Local`
- WSL/Remote 项目在旧流程中不存于 `ProjectManager` → 新流程中统一注入，不影响旧数据的加载
