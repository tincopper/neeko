# 架构优化实施

## Goal

基于已有的技术方案（`docs/architecture-optimization-plan.md`）和实施方案（`docs/architecture-optimization-impl-plan.md`），对 Neeko 项目进行系统性架构优化，消除代码重复、浅模块、prop drilling 等架构债务。

## What I already know

- **技术方案**：`docs/architecture-optimization-plan.md` — 7 个优化提案的详细设计
- **实施方案**：`docs/architecture-optimization-impl-plan.md` — 6 个 Phase，每步有文件清单、验证点、回滚策略
- **分支**：`refactor/architecture-optimization`（从 main 切出，已存在）
- **总工期估算**：18-27 天（乐观 ~15 天）
- **预期代码量变化**：后端 ~19,675 → ~17,095 行，前端 ~13,000 → ~11,880 行

### 6 个 Phase 概览

| Phase | 内容 | 复杂度 | 估算 |
|-------|------|--------|------|
| 0 | 基础设施准备（测试基线） | 低 | 0.5 天 |
| 1A | SSH 认证整合 | 低 | 1 天 |
| 1B | Theme 安装编排 | 低 | 2 天 |
| 2A | Prop 塌缩 Phase 1-2 | 低 | 1.5 天 |
| 2B | useAppContainer 拆分 | 中 | 2 天 |
| 3A | Terminal 视图合并 | 中 | 3 天 |
| 3B | Prop 塌缩 Phase 3-4 | 中 | 2 天 |
| 4 | Store 切片拆分 | 中 | 3-4 天 |
| 5 | Git 操作统一 | 高 | 5-8 天 |

## Decision (ADR-lite)

**Context**: 架构优化总计 6 个 Phase，工期 18-27 天。一次性实施风险高、上下文窗口大。
**Decision**: 先实施 Phase 0 + Phase 1（基础设施准备 + SSH认证整合 + Theme安装编排），约 2-3 天。后续 Phase 根据效果启动新任务。
**Consequences**: 快速验证重构流程，建立安全网。SSH 认证和 Theme 是独立模块，互不影响，可并行执行。

## Requirements

* 基于实施方案逐步执行，每个 Phase 结束时重跑测试基线
* 每步独立可验证（`cargo check` / `npx tsc --noEmit`）
* 新旧代码可共存，支持单步回滚
* **本次范围：Phase 0 + Phase 1（1A + 1B）**

### Phase 0：基础设施准备
- 记录全量测试基线（前端 + Rust）
- 记录类型检查基线（tsc + cargo check）
- 确认当前测试全部通过

### Phase 1A：SSH 认证整合
- 创建 `src-tauri/src/utils/command/ssh_auth.rs`
- 提取 `authenticate()` 和 `connect_and_authenticate()`
- 重构 `remote.rs`（3 处）和 `ssh.rs`（1 处）调用
- 净减 ~40 行

### Phase 1B：Theme 安装编排
- 创建 `src-tauri/src/theme/` 模块（mod.rs + common.rs）
- 移动 `opencode_theme.rs` → `theme/opencode.rs`
- 移动 `pi_theme.rs` → `theme/pi.rs`
- 创建 `ThemeContext` enum 和统一编排函数
- 净减 ~200 行

## Acceptance Criteria

- [ ] Phase 0：测试基线记录（通过数量），`npx tsc --noEmit` 零 error，`cargo check` 零 error
- [ ] Phase 1A：`ssh_auth.rs` 存在，`remote.rs` 和 `ssh.rs` 中无重复 auth 代码块，`cargo test` 全通过
- [ ] Phase 1B：`theme/` 目录存在，`read_neeko_theme()` 只在 `theme/common.rs` 中，`cargo test` 全通过
- [ ] 每个 Phase 有独立 git commit

## Definition of Done

- 每个 Phase 的测试基线全部通过（前端 + Rust）
- 类型检查零 error（`npx tsc --noEmit` + `cargo check`）
- 每个 Phase 有独立 git commit（可单独回滚）
- 文档更新（如接口变化影响）

## Out of Scope

- Phase 2-5（Prop 塌缩、Terminal 合并、Store 拆分、Git 统一）— 后续任务
- 不新增功能，纯重构
- 不改动业务逻辑
- 不重新设计 UI

## Technical Approach

**执行顺序**：
1. Phase 0 — 记录基线（~30 min）
2. Phase 1A — SSH 认证整合（独立，~1 天）
3. Phase 1B — Theme 安装编排（独立，可与 1A 并行，~2 天）
4. Phase 1 结束 — 重跑基线验证

**关键文件**（Phase 1A）：
- 新建：`src-tauri/src/utils/command/ssh_auth.rs`
- 修改：`src-tauri/src/remote.rs`（3 处 auth 块）
- 修改：`src-tauri/src/utils/command/ssh.rs`（1 处 auth 块）

**关键文件**（Phase 1B）：
- 新建：`src-tauri/src/theme/mod.rs`、`theme/common.rs`
- 移动：`opencode_theme.rs` → `theme/opencode.rs`、`pi_theme.rs` → `theme/pi.rs`
- 修改：`app.rs`、`terminal.rs`、`remote.rs`、`commands/config.rs`

## Technical Notes

- 技术方案详见 `docs/architecture-optimization-plan.md`
- 实施方案详见 `docs/architecture-optimization-impl-plan.md`
- 当前分支：`refactor/architecture-optimization`
- Phase 1A 和 1B 完全独立，互不影响

## Technical Notes

- 技术方案详见 `docs/architecture-optimization-plan.md`
- 实施方案详见 `docs/architecture-optimization-impl-plan.md`
- 当前分支：`refactor/architecture-optimization`
