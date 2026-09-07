# 技术设计

## Scope

处理文件树读取的两个 Block 级问题，以及二轮审查剩余 6 个 Warning；保持文件树 API 外部形状与前端调用方式不变。

## 1. WSL / Remote `sub_path` 安全边界

### 方案

在 `common/file/services.rs` 内新增纯函数：

```rust
fn validate_remote_sub_path(sub_path: &str) -> Result<(), AppError>
```

校验规则：

- `sub_path.is_empty()` 拒绝；
- `sub_path.starts_with('/')` 拒绝；
- 包含 `\` 拒绝；
- 包含 NUL 拒绝；
- 按 `/` 切分后，空段、`.`、`..` 均拒绝。

`read_dir_tree()` 在 WSL / Remote 分支中先对非空 `effective_sub` 调用该函数，然后才拼接：

```rust
format!("{}/{}", root_path, sub_path)
```

### 理由

- 远程路径没有本机文件系统可用于 `canonicalize()`，必须先做语法级相对路径校验。
- 该规则比 shell 转义更强：`safe_path()` 只能防止命令注入，不能防止越出项目根。
- 保留合法的 `/` 分隔相对路径，避免破坏 WSL / Remote 懒加载目录树功能。
- 拒绝反斜杠可避免 Windows 风格穿越语义混入 Unix WSL / Remote shell 路径。

## 2. Local blocking I/O 隔离

### 方案

将 Local 分支中的 `read_dir_recursive()` 移入 `tokio::task::spawn_blocking`：

- 在进入 closure 前，把 `root_path` 与 `target_path` 转为 owned `PathBuf`；
- `gitignore: Option<&GitIgnoreFilter>` 通过 `Option<GitIgnoreFilter>` clone 后 move 进 closure；
- closure 内同步执行 `read_dir_recursive()`；
- await `JoinHandle`，`JoinError` 转为 `AppError::File`；
- 保留现有 `validate_within_root()` 作为进入 blocking 任务的路径安全闸门。

### 类型处理

`GitIgnoreFilter` 内部使用 `Arc<RwLock<...>>`，已经实现 `Clone`，克隆成本低且共享规则数据，不复制规则本体。

## 3. 不回退项

- WSL / Remote 仍调用 `fetch_remote_ignored_paths()` 获取 ignored 路径集合；
- 仍调用 `apply_ignored_to_tree()` 做标记与剪枝；
- Local 仍使用传入的 `GitIgnoreFilter`；
- 远程命令构造与 shell 选择保持现有语义。

## Testing

### Red 阶段

1. 新增 `validate_remote_sub_path` 行为测试，先确认业务函数不存在或未生效导致失败。
2. 新增 Local `read_dir_tree()` 的 Tokio 运行时行为测试，确认正常树读取不回退。

### Green 阶段

实现最小修复，使测试通过。

### Regression

- `services::tests` 全量通过；
- watcher / gitignore 相关测试通过；
- 后端 lint 与测试通过。

## 4. 远程 ignored 输出容量上限

把 `fetch_remote_ignored_paths()` 中的文本解析抽成纯函数：

```rust
fn parse_remote_ignored_output(output: &str) -> HashSet<String>
```

- 逐行去空白、去尾部 `/`；
- 跳过空行；
- 去重；
- 达到 `MAX_IGNORED_PATHS` 后停止收集并 `log::warn!`；
- `fetch_remote_ignored_paths()` 只负责执行命令并委托解析，保证容量边界可直测。

## 5. WSL / Remote ignored 查询缓存

新增模块内进程级缓存：

- key：`project_id + target_id + root_path`；
- value：`HashSet<String>` 与 `Instant`；
- TTL：30 秒，作为 watcher 失效不可靠时的兜底；
- target_id 仅使用稳定非敏感信息（distro 或 user@host:port），不缓存凭据；
- 缓存访问全部走 mutex，不在持锁期间执行远程命令；
- `WatcherManager` 在 `.gitignore` / `.git/info/exclude` 变化与 `unwatch()` 时显式清除对应 project 缓存。

`read_dir_tree()` 增加 `project_id: &str` 参数，命令层继续从 Tauri 状态拿到 `project_id` 后传入；测试直接使用明确 key，避免隐式全局歧义。

## 6. Watcher 与 IPC 契约修正

- Selective 降级测试补齐真实 `.gitignore` 与 `Some(&filter)`，确保测试覆盖 git 项目注册路径；非 git 分支保留独立语义测试。
- mutex 锁失败是进程内共享状态异常：初始注册直接 `warn!` 并返回；maintenance 线程 `warn!` 后退出循环；不再使用 `expect()` 崩溃。
- `GitPerfSuggestion` / `GitPerfSuggestionEvent` 迁到 `src/shared/types/git.ts`，Hook 只消费 shared 契约；Rust serde 字段保持 snake_case 同步。

## 7. Perf 阈值链路测试

使用同步 `#[test]` 与真实 temp git 仓库构造 tracked 文件数量：

- 小于阈值：返回空；
- 大于等于阈值且 `core.fsmonitor` / `core.untrackedCache` 未启用：返回两条建议；
- 大于等于阈值且两项启用：返回空。

`detect_perf_suggestions()` 内部使用同步桥，测试必须保持同步 `#[test]`，不得放入 `#[tokio::test]`。
