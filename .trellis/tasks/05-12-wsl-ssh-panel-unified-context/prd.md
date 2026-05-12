# PRD：WSL/SSH 右侧面板统一接口支持（方案 A — Active Project Context）

> **任务 ID**: `05-12-wsl-ssh-panel-unified-context`
> **优先级**: P1
> **类型**: fullstack（Frontend + Backend）
> **分支**: `feature/wsl-ssh-panel-unified-context`
> **Scope**: `panel`

---

## 一、背景与问题

当前右侧三个面板（Files Panel、Git Commit Panel、Git Log Panel）**只对本地项目有效**。
选中 WSL 或 SSH 项目后，`appStore` 中 `activeProject` 被置为 `null`，导致：

- **Files Panel** → 显示 "No project selected"，无法浏览远程文件树
- **Git Commit Panel** → 显示 "No project selected"，无法 stage / commit / push
- **Git Log Panel** → 显示 "No project selected"，无法查看历史

根本原因：面板包装器（`DockPanelWrappers.tsx`）和面板 hooks 直接依赖 `activeProject`（本地专属 store 字段），未抽象出跨类型的统一接口。

---

## 二、目标

通过引入 **Active Project Context 统一接口层**，让三个右侧面板在 Local / WSL / SSH 三种项目类型下无差别工作，同时：

1. **高内聚**：每种项目类型的连接细节（命令构造、参数绑定）封装在各自的 command factory 内，外部不感知传输方式
2. **低耦合**：面板组件只依赖 `ProjectCommands` 接口和 `ProjectCapabilities` 能力声明，不直接依赖 `invoke()` 字符串或项目类型标识
3. **不随意开发**：严格遵循 TDDD（Type-Driven Development）——先写类型 / 接口定义与失败测试，再补充实现，拒绝在没有类型约束和测试覆盖的情况下编写功能代码

---

## 三、TDDD 开发约束（强制）

> **本任务全程遵循 TDDD 模式，每个 Step 必须先于实现代码完成接口定义与测试骨架。**

### TDDD 执行规则

| 规则 | 说明 |
|------|------|
| **T1: 类型先行** | 每个新模块必须先完整定义 TypeScript 类型 / Rust trait & struct，才能编写实现代码 |
| **T2: 测试骨架先于实现** | 每个新函数/命令必须先写出测试用例（可以 `todo!()` / `vi.todo()`），再写实现 |
| **T3: 接口稳定后再实现** | `ProjectCommands` 接口在 Step 1 定义后不得在后续 Step 中随意增减方法；变更须走 PRD 评审 |
| **T4: 禁止跳步** | 不允许跳过 Step 直接进入下一 Step 的实现，每个 Step 有独立的验收门控 |
| **T5: 回归必须绿灯** | 每个 Step 结束前必须通过最小回归集（lint + type-check + test:run + cargo test） |

---

## 四、高内聚低耦合设计约束

### 高内聚约束（H）

| 编号 | 约束 | 违例示例（禁止） |
|------|------|-----------------|
| H1 | command factory 文件只负责「将连接参数绑定到 invoke 调用」，不包含 UI 逻辑 | factory 里写 toast 通知 |
| H2 | `useActiveProject` hook 只负责「读取 store → 构建 context」，不包含副作用 | hook 里做 git refresh |
| H3 | 能力矩阵（`capabilities.ts`）只声明布尔能力，不包含任何条件渲染逻辑 | capabilities 文件里写 JSX |
| H4 | 每个后端新命令只做一件事（单一 git 操作），不合并多步操作 | commit 命令内部自动 push |
| H5 | 类型定义文件（`activeProject.ts`）不 import 任何 React / Tauri / store 模块 | 类型文件 import useAppStore |

### 低耦合约束（L）

| 编号 | 约束 | 违例示例（禁止） |
|------|------|-----------------|
| L1 | 面板组件（`GitCommitPanel`、`GitLogPanel`、`FilesPanel`）不直接调用 `invoke()`，只通过 `commands.xxx()` | Panel 里出现 `invoke("stage_files_command", ...)` |
| L2 | 面板组件不 import `appStore`，只通过 `useActiveProject()` 获取数据 | Panel 里出现 `useAppStore(...)` |
| L3 | `DockPanelWrappers.tsx` 不感知具体项目类型，只消费 `useActiveProject()` 返回值 | Wrapper 里出现 `if (type === "wsl")` |
| L4 | command factory 三个变体（local/wsl/remote）不相互 import，各自独立 | `wslCommandFactory` import `localCommandFactory` |
| L5 | 后端新命令不通过 `State<AppStateWrapper>` 查找项目，连接参数由前端直接传入 | wsl 命令用 project_id 从 manager 查路径 |

---

## 五、功能需求

### 5.1 前端——统一接口层

#### F1: 类型定义模块 `src/types/activeProject.ts`
- [ ] 定义 `ProjectType = "local" | "wsl" | "remote"`
- [ ] 定义 `ConnectionContext` 判别联合（local/wsl/remote 三变体）
- [ ] 定义 `UnifiedProjectView`（id, name, path, gitInfo, selectedAgent, selectedIde, type）
- [ ] 定义 `ProjectCommands` 接口（完整方法集，见附录 A）
- [ ] 定义 `ProjectCapabilities`（每个操作一个布尔字段）
- [ ] 定义 `ActiveProjectContext`（project + commands + capabilities + connectionContext + worktreePath）
- [ ] **无任何 React / Tauri / store import**（H5 约束）

#### F2: Command Factory `src/hooks/useActiveProject/commandFactory.ts`
- [ ] `createLocalCommands(projectId: string): ProjectCommands` — 绑定 local invoke
- [ ] `createWslCommands(distro: string, projectPath: string): ProjectCommands` — 绑定 wsl invoke
- [ ] `createRemoteCommands(host, port, username, auth, projectPath): ProjectCommands` — 绑定 remote invoke
- [ ] 三个 factory 函数不相互 import（L4 约束）
- [ ] 每个 factory 对应完整的单元测试 mock（T2 约束）

#### F3: 能力矩阵 `src/hooks/useActiveProject/capabilities.ts`
- [ ] `getCapabilities(type: ProjectType): ProjectCapabilities`
- [ ] local: 全能力开启
- [ ] wsl: 关闭 canEditFiles / canGenerateCommitMessage / canManagePRs
- [ ] remote: 同 wsl
- [ ] 纯函数，无副作用（H3 约束）

#### F4: 适配器 `src/hooks/useActiveProject/adapters.ts`
- [ ] `toUnifiedView(type, project): UnifiedProjectView` — 三种类型转统一视图
- [ ] WSL/Remote `id` 生成规则：`wsl:{distro}:{path}` / `remote:{host}:{path}`

#### F5: 主 Hook `src/hooks/useActiveProject/index.ts`
- [ ] `useActiveProject(): ActiveProjectContext`
- [ ] 读取 store 三种 active project 状态
- [ ] `useMemo` 包裹，依赖数组精确声明
- [ ] 返回值在 project 为 null 时全部字段为 null（不抛出）
- [ ] 不包含任何副作用（H2 约束）

#### F6: DockPanelWrappers 改造 `src/components/dock/DockPanelWrappers.tsx`
- [ ] `FilesPanelWrapper` 改用 `useActiveProject()`，传入 `commands`
- [ ] `GitCommitPanelWrapper` 改用 `useActiveProject()`，传入统一 project + commands + capabilities
- [ ] 不出现 `if (type === "xxx")` 类型分支（L3 约束）

#### F7: GitCommitPanel 改造 `src/components/project/GitCommitPanel.tsx`
- [ ] Props 改为 `{ project: UnifiedProjectView; commands: ProjectCommands; capabilities: ProjectCapabilities; onRefreshGit: () => Promise<void> }`
- [ ] 所有 `invoke()` 调用替换为 `commands.xxx()`（L1 约束）
- [ ] 不直接 import appStore（L2 约束）
- [ ] 使用 `capabilities.canXxx` 控制 AI 生成、PR 管理等按钮可见性
- [ ] `BranchInfo`、`ChangesList` 子组件接口不变（已是纯展示组件）

#### F8: GitLog 改造
- [ ] `useGitLog.ts`: 参数从 `projectId: string | null` 改为 `commands: ProjectCommands | null`
- [ ] `useCommitDetail.ts`: 参数改为 `commands: ProjectCommands | null; commitHash: string | null`
- [ ] `GitLogPanel.tsx`: 从 `useActiveProject()` 获取 `commands` 和 `capabilities`
- [ ] action 处理器（cherry-pick/revert/tag 等）通过 `commands.xxx()` 调用

#### F9: useFileView 改造 `src/hooks/useFileView.ts`
- [ ] 接受 `commands: ProjectCommands | null` 和 `worktreePath: string | null`
- [ ] `read_dir_tree` invoke 改为 `commands.readDirTree()`
- [ ] `read_file_content` invoke 改为 `commands.readFileContent()`
- [ ] `write_file_content` invoke 改为 `commands.writeFileContent()`

---

### 5.2 后端——新增命令

#### B1: WSL 新增命令（`src-tauri/src/commands/wsl_git.rs`）

每个命令先写 `#[cfg(test)]` 测试骨架（T2 约束），再写实现。

| 命令 | 实现机制 | 返回类型 |
|------|----------|---------|
| `wsl_stage_files` | `run_wsl_git(["add", "--", ...files])` | `Result<(), AppError>` |
| `wsl_unstage_files` | `run_wsl_git(["restore", "--staged", "--", ...files])` | `Result<(), AppError>` |
| `wsl_discard_file` | `run_wsl_git(["checkout", "--", file])` | `Result<(), AppError>` |
| `wsl_commit_files` | stage all then `run_wsl_git(["commit", "-m", msg])` | `Result<CommitResult, AppError>` |
| `wsl_push` | `run_wsl_git(["push"])` + upstream flag | `Result<(), AppError>` |
| `wsl_pull` | `run_wsl_git(["pull"])` | `Result<(), AppError>` |
| `wsl_fetch` | `run_wsl_git(["fetch", "--all"])` | `Result<(), AppError>` |
| `wsl_get_commit_log` | `run_wsl_git(["log", "--format=...", "-n", count, "--skip", skip])` | `Result<Vec<CommitEntry>, AppError>` |
| `wsl_get_commit_detail` | `run_wsl_git(["show", "--format=...", hash])` | `Result<CommitDetail, AppError>` |
| `wsl_get_commit_files` | `run_wsl_git(["diff-tree", "--no-commit-id", "-r", hash])` | `Result<Vec<CommitFileChange>, AppError>` |
| `wsl_get_commit_file_diff` | `run_wsl_git(["diff", "hash^..hash", "--", file])` | `Result<DiffResult, AppError>` |
| `wsl_get_ahead_behind` | `run_wsl_git(["rev-list", "--left-right", "--count", "HEAD...@{u}"])` | `Result<AheadBehind, AppError>` |
| `wsl_cherry_pick` | `run_wsl_git(["cherry-pick", hash])` | `Result<(), AppError>` |
| `wsl_revert_commit` | `run_wsl_git(["revert", "--no-edit", hash])` | `Result<(), AppError>` |
| `wsl_create_tag` | `run_wsl_git(["tag", name])` | `Result<(), AppError>` |
| `wsl_read_dir_tree` | WSL exec `find` → 解析为 `Vec<FileNode>` | `Result<Vec<FileNode>, AppError>` |

#### B2: Remote 新增命令（`src-tauri/src/commands/remote_git.rs`）

与 B1 完全对称，参数从 `(distro, project_path)` 改为 `(host, port, username, auth, project_path)`。

| 命令 | 对应 WSL 命令 |
|------|--------------|
| `remote_stage_files` | `wsl_stage_files` |
| `remote_unstage_files` | `wsl_unstage_files` |
| `remote_discard_file` | `wsl_discard_file` |
| `remote_commit_files` | `wsl_commit_files` |
| `remote_push` | `wsl_push` |
| `remote_pull` | `wsl_pull` |
| `remote_fetch` | `wsl_fetch` |
| `remote_get_commit_log` | `wsl_get_commit_log` |
| `remote_get_commit_detail` | `wsl_get_commit_detail` |
| `remote_get_commit_files` | `wsl_get_commit_files` |
| `remote_get_commit_file_diff` | `wsl_get_commit_file_diff` |
| `remote_get_ahead_behind` | `wsl_get_ahead_behind` |
| `remote_cherry_pick` | `wsl_cherry_pick` |
| `remote_revert_commit` | `wsl_revert_commit` |
| `remote_create_tag` | `wsl_create_tag` |
| `remote_read_dir_tree` | `wsl_read_dir_tree` |

#### B3: Git 实现层扩展
- `src-tauri/src/git/wsl.rs`: 新增 commit/stage/push/pull/fetch/log 相关函数
- `src-tauri/src/git/remote.rs`: 同 wsl，全 async
- Git log 格式约定：JSON Lines，每行一个 commit（复用 `parse_git_info_output` 已有的解析基础）

#### B4: 命令注册
- 所有新命令加入 `neeko_invoke_handler!` 宏（`src-tauri/src/commands/mod.rs`）
- WSL 命令保持 `#[cfg(target_os = "windows")]` 门控

---

## 六、开发分阶段计划（Step Gate）

> 每个 Step 是独立的开发单元，有独立的验收门控，不允许跨步。

### Step 1 — 类型层 & 接口定义（纯新增，零破坏）

**交付物**：
- `src/types/activeProject.ts` 完整类型定义
- `src/hooks/useActiveProject/commandFactory.ts` 接口骨架（方法返回 `Promise.reject("not implemented")`）
- `src/hooks/useActiveProject/capabilities.ts` 完整能力矩阵
- `src/hooks/useActiveProject/adapters.ts` `toUnifiedView` 实现
- `src/hooks/useActiveProject/index.ts` hook 骨架
- 对应单元测试文件（内容为 `vi.todo()` 占位测试）

**验收门控**：
- [ ] `pnpm type-check` 通过（新类型无错误）
- [ ] `pnpm lint` 通过
- [ ] 现有功能完全不受影响（所有现有测试保持绿灯）
- [ ] `ProjectCommands` 接口经过 review 确认稳定，签字锁定

**TDDD 检查点**：`ProjectCommands` 接口方法数量与附录 A 一致，类型注释完整

---

### Step 2 — Command Factory 完整实现 + 单元测试（纯新增）

**交付物**：
- `createLocalCommands` 完整实现（调用现有 invoke 命令）
- `createWslCommands` 完整实现（调用现有 WSL invoke 命令；新增的 wsl 命令先用 `invoke("todo", ...)` 占位）
- `createRemoteCommands` 完整实现（同上）
- `useActiveProject` hook 完整实现
- 所有 `vi.todo()` 升级为真实测试用例（mock invoke，验证参数绑定正确）

**验收门控**：
- [ ] `pnpm type-check` 通过
- [ ] `pnpm test:run` factory 测试全绿
- [ ] `createLocalCommands` 的每个方法都有对应测试覆盖 invoke 参数
- [ ] 三个 factory 文件互不 import（L4 检查）

**TDDD 检查点**：测试文件与实现文件同步提交，禁止先提交实现再补测试

---

### Step 3 — DockPanelWrappers + GitCommitPanel 改造

**前置条件**: Step 2 验收通过

**交付物**：
- `DockPanelWrappers.tsx` 改造（使用 `useActiveProject()`）
- `GitCommitPanel.tsx` Props 类型更新 + 所有 invoke 替换
- 对应组件测试更新

**验收门控**：
- [ ] `pnpm type-check` 通过
- [ ] `pnpm lint` 通过
- [ ] 本地项目的 GitCommitPanel 功能完全正常（回归测试）
- [ ] WSL 项目选中后 GitCommitPanel 显示正确的 changed files（非 "No project selected"）
- [ ] 面板组件文件内无 `invoke(` 字符串（L1 检查：`rg "invoke\(" src/components/project/`）
- [ ] 面板组件文件内无 `useAppStore(` 字符串（L2 检查）

---

### Step 4 — 后端 WSL 新增命令（B1）

**前置条件**: Step 1 验收通过（类型定义稳定）

**交付物**：
- `wsl_git.rs` 新增 16 个命令
- `git/wsl.rs` 新增相应 git 实现函数
- 每个命令的 `#[cfg(test)]` 测试（至少 1 个 happy path）
- `neeko_invoke_handler!` 注册

**验收门控**：
- [ ] `cargo check` 通过
- [ ] `cargo test` WSL 命令测试通过
- [ ] 在真实 WSL 环境执行 `wsl_stage_files` 和 `wsl_commit_files` 验证
- [ ] 所有新 WSL 命令直接接受连接参数，不通过 `State<AppStateWrapper>`（L5 检查）

---

### Step 5 — 后端 Remote 新增命令（B2）

**前置条件**: Step 4 验收通过（复用 WSL 命令的解析函数）

**交付物**：
- `remote_git.rs` 新增 16 个命令（与 Step 4 完全对称）
- `git/remote.rs` 新增相应 async git 实现函数
- 每个命令的测试骨架
- `neeko_invoke_handler!` 注册

**验收门控**：
- [ ] `cargo check` 通过
- [ ] `cargo test` Remote 命令测试通过
- [ ] SSH 项目 commit 流程端到端验证

---

### Step 6 — GitLog + FilesPanel 改造 + createWslCommands/createRemoteCommands 完整兑现

**前置条件**: Step 4 & 5 验收通过（后端命令已就绪）

**交付物**：
- `useGitLog.ts` 改为接受 `commands` 参数
- `useCommitDetail.ts` 同上
- `GitLogPanel.tsx` 使用 `useActiveProject()`
- `useFileView.ts` 改造
- `createWslCommands` / `createRemoteCommands` 中占位的 `invoke("todo")` 全部替换为真实命令名

**验收门控**：
- [ ] WSL 项目 Git Log 显示 commit 历史
- [ ] SSH 项目 Files Panel 显示文件树
- [ ] `pnpm type-check` + `pnpm test:run` + `cargo test` 全绿
- [ ] 最小回归集全绿：`pnpm lint && pnpm type-check && pnpm test:run && cargo test --manifest-path src-tauri/Cargo.toml`

---

## 七、不在范围内（Out of Scope）

- WSL/SSH 项目的文件**编辑**（写入）支持（能力标记为 `canEditFiles: false`，UI 只读）
- WSL/SSH 项目的 PR 管理（需要 `gh` CLI 授权，超出本任务范围）
- WSL/SSH 项目的 AI commit message 生成
- Worktree 的完整 WSL/SSH 支持（已有独立任务）
- 对现有 local 项目行为的任何改变（纯扩展，不修改现有逻辑）

---

## 八、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| SSH 命令执行延迟（>500ms） | 面板操作体验卡顿 | 所有 remote commands 加 loading 状态；commit log 默认取 50 条分页 |
| WSL `run_wsl_git` 参数注入 | 安全风险 | 复用已有 `safe_path()` 转义，禁止字符串拼接路径 |
| `ProjectCommands` 接口后续增改 | 破坏三个 factory 实现 | Step 1 接口签字锁定；后续变更走 PRD 评审 |
| Git log 输出格式不一致 | 解析失败 | 约定固定 `--format` 模板，加单元测试验证解析 |
| WSL 非 Windows 平台编译 | CI 失败 | 所有 WSL 命令保持 `#[cfg(target_os = "windows")]` 门控 |

---

## 九、验收标准（最终）

**功能验收**：
- [ ] 选中 WSL 项目 → Files Panel 显示 WSL 文件树（不可编辑）
- [ ] 选中 WSL 项目 → Git Commit Panel 显示 changed files，可 stage/commit/push
- [ ] 选中 WSL 项目 → Git Log Panel 显示 commit 历史，可 cherry-pick
- [ ] 选中 SSH 项目 → 以上三项同样成立
- [ ] 选中 Local 项目 → 所有现有功能完全不受影响

**架构验收**（rg 命令自动检查）：
- [ ] `rg "invoke\(" src/components/project/GitCommitPanel.tsx` → 无匹配（L1）
- [ ] `rg "invoke\(" src/components/gitlog/GitLogPanel.tsx` → 无匹配（L1）
- [ ] `rg "useAppStore" src/components/project/GitCommitPanel.tsx` → 无匹配（L2）
- [ ] `rg "type.*===.*wsl\|type.*===.*remote" src/components/dock/DockPanelWrappers.tsx` → 无匹配（L3）
- [ ] `rg "AppStateWrapper" src-tauri/src/commands/wsl_git.rs` → 仅出现在新命令前（新命令无 State 参数）（L5）

**质量验收**：
- [ ] `pnpm lint` 通过
- [ ] `pnpm type-check` 通过
- [ ] `pnpm test:run` 通过（新增测试覆盖率 > 80% for command factories）
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 通过

---

## 附录 A：`ProjectCommands` 接口完整方法集

```typescript
interface ProjectCommands {
  // Git Info
  refreshGitInfo(): Promise<GitInfo>;
  getAheadBehind(): Promise<AheadBehind>;

  // Staging
  stageFiles(filePaths: string[]): Promise<void>;
  unstageFiles(filePaths: string[]): Promise<void>;
  discardFile(filePath: string): Promise<void>;

  // Commit
  commitFiles(filePaths: string[], message: string): Promise<CommitResult>;

  // Sync
  fetch(): Promise<void>;
  pull(): Promise<void>;
  push(setUpstream?: boolean): Promise<void>;

  // Branch
  checkoutBranch(branchName: string): Promise<void>;
  createBranch(branchName: string, startPoint?: string): Promise<void>;
  deleteBranch(branchName: string): Promise<void>;

  // Log
  getCommitLog(count: number, skip?: number): Promise<CommitEntry[]>;
  getCommitDetail(commitHash: string): Promise<CommitDetail>;
  getCommitFiles(commitHash: string): Promise<CommitFileChange[]>;
  getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult>;

  // Advanced Git
  cherryPick(commitHash: string): Promise<void>;
  revert(commitHash: string): Promise<void>;
  createTag(tagName: string, message?: string): Promise<void>;

  // Files
  readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]>;
  readFileContent(filePath: string, rootPath?: string): Promise<FileContent>;
  writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void>;

  // AI (capability-gated)
  generateCommitMessage(filePaths: string[]): Promise<string>;
}
```

> **注意**：方法签名在 Step 1 完成后视为稳定版本，后续 Step 不得修改，除非经过明确的版本迭代评审。

---

## 附录 B：文件变更清单

| 操作 | 文件 | Step |
|------|------|------|
| 新增 | `src/types/activeProject.ts` | 1 |
| 新增 | `src/hooks/useActiveProject/index.ts` | 1-2 |
| 新增 | `src/hooks/useActiveProject/commandFactory.ts` | 1-2 |
| 新增 | `src/hooks/useActiveProject/capabilities.ts` | 1 |
| 新增 | `src/hooks/useActiveProject/adapters.ts` | 1 |
| 新增 | `src/hooks/useActiveProject/__tests__/commandFactory.test.ts` | 2 |
| 修改 | `src/components/dock/DockPanelWrappers.tsx` | 3 |
| 修改 | `src/components/project/GitCommitPanel.tsx` | 3 |
| 修改 | `src/components/gitlog/GitLogPanel.tsx` | 6 |
| 修改 | `src/components/gitlog/useGitLog.ts` | 6 |
| 修改 | `src/components/gitlog/useCommitDetail.ts` | 6 |
| 修改 | `src/hooks/useFileView.ts` | 6 |
| 修改 | `src-tauri/src/commands/wsl_git.rs` | 4 |
| 修改 | `src-tauri/src/commands/remote_git.rs` | 5 |
| 修改 | `src-tauri/src/git/wsl.rs` | 4 |
| 修改 | `src-tauri/src/git/remote.rs` | 5 |
| 修改 | `src-tauri/src/commands/mod.rs` | 4-5 |
| 删除（可选） | `src/types/adapter.ts` | 6（清理） |
