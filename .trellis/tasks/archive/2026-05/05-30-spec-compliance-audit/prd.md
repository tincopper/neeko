# Spec Compliance Audit — 修复合规 gap

## Goal

修复 `docs/neeko-development-spec.md` 合规审计发现的 P0/P1 gap，对齐代码库与架构规范。

## 已确认的修复项

### 1. editor 移入 app/ 层 (P0)
- 迁 `src/features/editor/` → `src/app/editor/`
- 更新所有导入路径
- 更新 ESLint zones

### 2. 直接 invoke 调用 - 方案A (P1)
- `terminalCache.ts` + `TerminalViewBase.tsx`: 策略对象 `closeSessionCmd`/`resizeCmd` 从字符串改为函数引用
- `useRemoteActions.ts`: api 文件 `export { invoke }` 再导出

### 3. 跨域 Rust 调用 (P1)
- `git → agent::services::commit`: AI commit message 逻辑提到 `core/` 公共模块
- `file → git::worker`: `GitStatusWorker` 提取到 `core/` 基础设施层

### 4. ESLint 规则级别 (P1)
- `no-restricted-imports` → `error`
- `import/no-cycle` → `error`
- `import/order` → `error`

### 5. 不处理项
- `src/routes/`: not applicable（无路由）
- `theme` feature 骨架: 保持现状（太简单）
- `src/stores/`: 待确认已有 `src/store/`
- `src/components/` vs `src/ui/` vs `src/shared/`: 待讨论
- `core/db.rs` stub: 待讨论
- `unwrap_used` spec drift: 待同步 spec

## Acceptance Criteria

- [ ] editor 迁移完成，`pnpm tsc --noEmit` 通过
- [ ] direct invoke 修复，ESLint `no-restricted-imports` 验证通过
- [ ] ESLint 规则升级后 `pnpm lint` 通过
- [ ] `pnpm lint` 通过

## Definition of Done

- Code changes committed
- Spec docs updated
- Lint / typecheck / tests pass

## Out of Scope (initial)

- 跨域 Rust 调用重构（待后续 task）
- `src/stores/` `src/components/` 目录整理（待后续讨论）
- `core/db.rs` 补齐（待后续 task）
