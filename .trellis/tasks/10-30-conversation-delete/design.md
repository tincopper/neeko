# 设计：历史会话删除（第一性原理推导）

> 需求见 `prd.md`，执行序见 `implement.md`。

## 0. 第一性原理：删除权限属于数据的拥有者

Neeko 的 conversation 域是一份**只读索引**：`ConversationManager` 内存缓存 + 磁盘扫描，
不拥有任何会话数据（`conversation-adapter.md` §2.2）。由此推出三条不可违的结论：

- **C1 执行权在拥有者**：agent 自己的 CLI 才知道「删这条会话」要连带做什么（codex 的
  `session_index.jsonl`、opencode 的 SQLite 行 + 子会话级联、claude 的 worktree）。
  绕过它直接删文件 = 留下陈旧索引/孤儿行，且**没有任何报错**。
- **C2 委派的前提是「同一处存储」**：只有当 CLI 操作的就是 Neeko 列出那条的存储时才可委派。
  qoder 实测反例：CLI 用 `~/.qoder/`，Neeko 读 `~/.qodercli/projects/` —— 委派会删错东西。
  另一条独立理由：qoder 的命令按**索引**寻址，索引随删除漂移（每次删除都得重新枚举）。
- **C3 没有官方命令时，删除单元 = 「这条会话独占的存储」**：能安全删的依据是「无二级索引 +
  不共享」。所以 pi 的 blob（内容寻址、跨会话共享）**不在**删除单元内；grok 的
  `summary.json` 与 `updates.jsonl` 同属一个会话目录 ⇒ 单元是目录；reasonix 的
  `<id>.jsonl` 与 `<id>.events.jsonl` 是一对 ⇒ 单元是两个文件。

⇒ 「删除支持」不是布尔值，而是 **三态**：`Native` / `Storage` / `Unsupported`。
把「没有命令」与「有命令但不能删这条」压成 `false`，会把实际可行的删除（pi 明明能删文件）隐藏掉；
反之把 qoder 当 `Native`，会删错库。**三态是 C1+C2 的直接推论，不是设计偏好。**

## 1. 能力面：与 `supports_resume` 同构

扫描时一次性把事实写进 meta：

```rust
pub enum SessionDeleteSupport { Native, Storage, Unsupported }

pub trait AgentSessionAdapter {
    /// 默认 Unsupported —— 新增 adapter 忘表态时宁可不提供入口（fail-closed）。
    fn delete_support(&self) -> SessionDeleteSupport { SessionDeleteSupport::Unsupported }
    /// Native：交给 CLI 的 argv（不含可执行文件名以外的 shell 参与，红线 1/2）
    fn delete_command(&self, _native_id: &str, _file_path: &Path) -> Option<Vec<String>> { None }
    /// Storage：本次删除要移除的路径集合（含兄弟文件/目录）；默认 = 会话文件本身
    fn delete_targets(&self, file_path: &Path, _native_id: &str) -> Vec<PathBuf> { vec![file_path.to_path_buf()] }
}
```

为什么放 trait 而不是 `match agent_id`（红线 10）：删除单元由存储形态决定，那是 adapter 的知识；
新增 agent 时只加实现，命令层与 UI 一行不改（OCP）。

**能力自洽性护栏**（与 `capability_probe` 同源）：
`delete_support() == Native ⇒ delete_command() 非空`；`== Storage ⇒ delete_targets() 非空且全部在
adapter 的 `session_root()` 之下`。任一条不成立 → 测试红（否则就是「声明了没人实现」的红线 14 形态）。

## 2. 执行路径（命令层极薄）

```
delete_conversation(id)                       # 红线 6：只校验 + 调度
  └─ manager.delete(id)
       ├─ 由 id 查缓存 meta（找不到 → AppError::NotFound，不触碰磁盘）
       ├─ adapter = 由 agent_id 定位（同一 registry）
       ├─ 防线：meta.file_path 必须 startswith(adapter.session_root())   # 缓存被污染也不越界
       ├─ match adapter.delete_support():
       │    Native  → exec::run(Local, argv[0], argv[1..], cwd=project_path?)
       │               非零退出 → AppError::Agent(stderr 尾部)
       │    Storage → spawn_blocking(remove_file / remove_dir_all each target)   # 红线 3
       │    Unsupported → AppError::Unsupported
       └─ 成功后：cache.remove(id) + scan_cache 失效该路径 + 返回 Ok
```

设计要点：

- **只收 id**（R2.1）：路径来自后端缓存，前端无法指定目标 —— 这是「任意文件删除」的唯一入口防线。
  比 `canonicalize` 更早更硬：不可信的输入根本到不了路径。
- **`Native` 的 cwd**：codex 的存储是全局（`~/.codex`），不需要 cwd；opencode 的 server 也不需要。
  qoder 若将来纳入委派才需要 cwd（本期不委派）。因此 argv 里由 adapter 决定是否要 cwd，命令层透传。
- **失败不乐观**：先执行、成功后才 `cache.remove`。前端在 `await` 成功后才本地移除行。
- **`Storage` 的多目标**：reasonix 两个文件、grok 一个目录 —— 逐个删，任一失败即整次失败并可归因
  （部分成功的后果写在错误里：告知哪些已删）。

## 3. 与既有代码的复用（不新造机制）

| 需求 | 复用 |
| --- | --- |
| 能力位 → 入口显隐 | 同 `ConversationMeta.supports_resume` 的模式（扫描期定事实，UI 零查询） |
| 确认弹窗 | `shared/store/confirmStore`（LSP 导入已在用） |
| 执行器 | `core::exec::run` + `SpawnSpec`（红线 1/2） |
| 缓存失效 | manager 现有 `register/unregister` 与 `scan_cache` 的按路径失效 |
| 前端命令封装 | `features/conversation/api/conversationApi.ts`（invoke 只在 api/） |

## 4. 权衡与被否方案

| 方案 | 否掉的理由 |
| --- | --- |
| 只在 Neeko 里「隐藏」（持久化隐藏清单） | Neeko 第一次开始持有会话状态 = 第二份真相；agent 自己的 `/resume` 仍能看到，用户以为是删了 |
| 所有 agent 统一直接删文件 | codex 的索引、opencode 的 SQLite 与子会话级联会被绕过，留下静默损坏 |
| qoder 委派 `--delete-session` | 存储路径不同（`~/.qoder/` vs `~/.qodercli/`）+ 按索引寻址 → 删错库 |
| 能力压成 bool | 见 §0：会隐藏 pi 等可行路径，或把 qoder 当可行 |
| 前端传路径给后端删 | 渲染层一旦被污染就是任意文件删除口子（红线 8 的同源风险） |
| 删除后「乐观移除」+ 后台重扫 | 失败时用户以为删了，磁盘其实还在（静默谎报） |

## 5. 风险与回滚

- **不可逆**：确认框必须写清将执行的动作与目标；`Storage` 路径直接进对话框（用户能核对）。
- **共享资产**：pi blob 不删（C3）；若未来出现「会话引用外部附件」的 agent，删除单元需再评估。
- **并发**：删除的会话若正被 agent 进程写入（用户同时在终端 `pi --session <id>`）→ 由 R3 的
  tab 保护覆盖 Neeko 内已知会话；终端直跑的场景属 best-effort，在确认框提示。
- 回滚粒度：adapter 能力位（P1）/ 命令与 manager（P2）/ UI（P3）各自独立可回滚；UI 先落地也安全
  （能力位全是 Unsupported 时入口不出现）。

## 6. 测试策略

| 层 | 用例 |
| --- | --- |
| 纯函数 | `delete_command` argv 构造（codex / opencode）；`delete_targets`（grok 目录、reasonix 两文件、默认单文件） |
| 契约 | 三态自洽：`Native ⇒ 有 argv`、`Storage ⇒ targets 非空且都在 session_root 内`；registry 覆盖所有 adapter |
| manager | id 不存在 → `NotFound` 且不触盘；路径越界（缓存被污染）→ 拒绝；`Storage` 删除后 cache 与 scan_cache 均失效（tempdir 夹具，红线 13） |
| 命令层 | 薄：参数校验 + 调度（不存在 id 的错误类型） |
| 前端 | 能力位 → 按钮显隐（含 Unsupported 不显示）；tab 打开时阻断；确认文案含 agent/标题/目标；成功后行移除；失败 toast |

**不真跑 codex/opencode**：委派路径用假二进制 + 记录的 argv 断言（与 pi 的
`command_capability_matches_each_transports_reality` 同一手法，CI 不起真进程）。
真机验证（AC1/AC2）放人工勾验清单。
