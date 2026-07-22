# Implement: Project UI — tag-group ↔ skill relations

## Completed Checklist

### 1. Data and IPC

- [x] Repository 增加 `get_all_project_tag_group_counts` GROUP BY 查询与测试。
- [x] SkillStore、Tauri 命令和 invoke handler 接入批量组数 API。
- [x] Skill API/store 增加组数 Map、loading/error 和刷新动作。
- [x] `apply_project_skills_cmd` 改为项目 `selected_agent` 单目标同步。
- [x] target 解析要求 Agent 存在且 `skill_path` 非空；缺失时成功 no-op。
- [x] 项目部署路径保持在项目根目录内，不触及全局 Agent 目录。

### 2. Project rail and bindings

- [x] 项目行展示磁盘 Skill 数与绑定组数，批量刷新且无值按 0。
- [x] `ProjectSkillContent` 加载并展示 Bound Tag Groups 与空态。
- [x] 挂载 `BindTagGroupsDialog`，保存后刷新绑定 DTO 和左侧组数。
- [x] 新增组 Skill 去重后只安装到 target Agent。
- [x] 无 target Agent 时保存绑定但跳过磁盘同步。
- [x] 解绑删除独占 Skill，保留仍被其他绑定组覆盖的 Skill。

### 3. Project Skill management

- [x] Bound Tag Group chip 支持筛选、重复点击取消和 All groups。
- [x] Skill 卡片显示绑定组与 target Agent 高亮。
- [x] 未关联 project-capable Agent 支持 install-only 添加。
- [x] 已关联 Agent 支持独立 enable/disable。
- [x] 页头支持设置、切换、清除 target Agent。
- [x] 前端 target 选项与后端一致：必须有非空 `skill_path`。

### 4. Navigation and Agents

- [x] Library、Tag、Agent、Project、Marketplace 选择状态互斥。
- [x] Agent Skill 列表改用共享 store，左侧计数同步刷新。
- [x] Agents List view 增加显式多选、过滤结果全选、清空和批量删除。
- [x] 卡片、筛选和图标按钮补充状态与可访问性标记。

### 5. Tests

- [x] SkillsPanel：双计数、错误/加载、rail 互斥。
- [x] ProjectSkillContent：绑定区、target-only import、无 target、解绑独占清理、共享 Skill 保留、组筛选、Agent 添加/启停、target 设置与无 `skill_path` 排除。
- [x] AgentSkillContent：多选、全选、批量删除与共享计数刷新。
- [x] Rust repository 计数测试。
- [x] Rust 项目目录隔离与无 target no-write 文件系统回归测试。

## Validation Record

### Passed

- `pnpm exec vitest run src/features/skill/components/__tests__/AgentSkillContent.test.tsx src/features/skill/components/__tests__/ProjectSkillContent.test.tsx src/features/skill/components/__tests__/SkillsPanel.test.tsx`
- `pnpm exec vitest run src/features/skill`
- `pnpm type-check`
- scoped ESLint（任务文件；关闭仓库已知无关配置规则）
- scoped Prettier check
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml skill::`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- scoped `cargo fmt --check`
- `git diff --check`

### Repository Baselines Outside This Task

- 全量 `cargo fmt --check` 在多个非 Skill Rust 文件失败；工作区同时存在这些文件的纯格式改动，本任务不暂存。
- 全量 Clippy 在非任务代码存在 13+ 个既有错误，主要包括 `src/common/git/status_worker.rs` 的不安全 `usize -> i32` 转换；任务生产代码没有新增 Clippy error。
- 全量 ESLint 受现有 filename 规则配置、跨 feature 历史引用、测试中直接 invoke、既有效果/accessibility 规则影响。
- 全量前端测试基线为 65 files passed / 5 failed，663 passed / 5 failed / 1 skipped；失败位于 split layout、ConversationItem、browser picker、remote project 和 WSL update，均不属于 Skill 任务。

## Manual / Runtime Validation

- [x] 通过组件测试执行绑定增减、target 选择、筛选、Agent 控制和批量删除交互。
- [x] Vite production build / dev server smoke 验证前端可编译和加载。
- [x] 原生路径写入通过 Rust 临时文件系统测试验证项目目录边界。
- [x] 浏览器模式不具备 Tauri IPC；原生绑定写盘不以浏览器手工操作代替测试。

## Final Review Gates

- [x] PRD AC1-AC13 与 D4/D5 一致。
- [x] design 不再描述全局 apply 或“解绑不删盘”的旧语义。
- [x] 七段式 code spec 记录跨层命令与路径契约。
- [x] 提交时只暂存当前任务文件，不包含工作区其他 Rust 改动。

## Rollback Points

| 范围 | 回滚影响 |
|------|----------|
| Rust Skill 命令/计数 | 恢复旧 apply 与计数接口；无需 DB rollback |
| Skill API/store | 移除批量组数与共享 Agent 状态 |
| Project/Agent UI | 恢复旧单视图交互；项目绑定数据仍保留 |
