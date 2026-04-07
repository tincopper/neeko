# 单元测试指南

> 前端（TypeScript/React）和后端（Rust/Tauri）的测试标准。

---

## 概述

本项目使用：
- **前端**：[Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- **后端**：Rust 内置测试框架（`cargo test`）+ [tempfile](https://docs.rs/tempfile/) 用于文件系统测试

前端测试中所有 Tauri IPC API（`invoke`、`listen`、`emit`）都被 mock。后端测试专注于 Manager 逻辑和纯函数——不需要运行 Tauri 应用。

---

## 指南索引

| 指南 | 说明 | 状态 |
|------|------|------|
| [前端测试](./frontend-testing.md) | Vitest 配置、Hook/组件测试、Tauri API mock | 已填写 |
| [后端测试](./backend-testing.md) | Rust 单元测试、git2 临时仓库、存储测试 | 已填写 |
| [Mock 策略](./mock-strategies.md) | Tauri invoke mock、xterm mock、平台存根 | 已填写 |

---

## 测试理念

### 测试什么

| 优先级 | 目标 | 原因 |
|--------|------|------|
| **P0** | 纯函数与工具类 | 零依赖，投入产出比最高 |
| **P0** | 数据模型序列化 | 捕获 Rust-TS 类型偏差 |
| **P1** | Manager 逻辑（Rust） | 核心业务逻辑 |
| **P1** | 自定义 Hooks（TS） | 驱动 UI 的状态逻辑 |
| **P2** | Git 操作 | 可用临时仓库测试 |
| **P2** | 存储持久化 | 可用临时目录测试 |
| **P3** | 组件渲染 | 验证关键 UI 行为 |

### 不需要单元测试的内容

- **PTY/终端 I/O** —— 需要真实 OS 资源，使用 E2E 测试
- **SSH 连接** —— 需要真实服务器，使用集成测试
- **Tauri 命令包装层** —— Manager 的薄封装，直接测试 Manager
- **CSS 样式** —— 视觉回归测试是独立的关注点

### 指导原则

1. **测试内部逻辑，而非框架包装** —— 测试 `ProjectManager.add_project()`，而非 `#[tauri::command] fn add_project()` 包装层
2. **真实优于 mock** —— 使用真实的临时 git 仓库，而非 mock git2
3. **在边界处 mock** —— 前端 mock Tauri IPC（`invoke`/`listen`），不 mock React 内部逻辑
4. **每个测试聚焦一个断言** —— 每个测试验证一个行为

---

## 推荐的测试优先顺序

向项目（当前零测试）添加测试时，按此顺序获得最大收益：

### 后端（Rust）

1. `agent.rs` —— 纯逻辑，零依赖，简单易测
2. `state.rs` —— serde 往返测试，捕获序列化 bug
3. `project.rs` —— 核心领域逻辑，需要 `tempfile`
4. `git.rs` —— `parse_unified_diff`（纯函数），git 操作（临时仓库）
5. `storage.rs` —— 使用临时目录的文件持久化

### 前端（TypeScript）

1. `utils/*.ts` —— 纯函数（平台检测、图标查找）
2. `useToast` / `useWorktreeState` —— 没有 Tauri 依赖的 Hooks
3. `useAppConfig` —— 简单的 Tauri invoke 模式
4. `useLocalProjects` —— 复杂 Hook，价值最高

---

## 运行测试

### 前端

```bash
pnpm test              # 监听模式
pnpm test:run          # 单次运行
pnpm test:coverage     # 带覆盖率报告
```

### 后端

```bash
cd src-tauri
cargo test             # 所有测试
cargo test agent       # 匹配 "agent" 的测试
cargo test -- --nocapture  # 显示 println 输出
```

---

## 测试文件命名与位置

### 前端

测试文件统一放在 `src/tests/` 独立目录下，按模块类型分子目录，使用 `.test.ts` / `.test.tsx` 后缀：

```
src/
├── tests/                              # 前端测试独立目录
│   ├── setup.ts                        # 全局测试配置（Tauri API mock）
│   ├── factories.ts                    # 共享测试数据工厂
│   ├── utils/
│   │   ├── platform.test.ts            # 工具函数测试
│   │   ├── terminal.test.ts
│   │   └── ...
│   ├── hooks/
│   │   ├── useToast.test.ts            # Hook 测试
│   │   ├── useAppConfig.test.ts
│   │   └── ...
│   └── components/
│       ├── FileTree.test.tsx            # 组件测试
│       └── ...
├── utils/
├── hooks/
└── components/
```

测试文件通过相对路径导入源码：

```typescript
import { IS_WINDOWS } from '../../utils/platform';
import { useToast } from '../../hooks/useToast';
```

### 后端

测试位于源代码同一文件中，在 `#[cfg(test)]` 模块内：

```rust
// src-tauri/src/agent.rs

pub struct AgentManager { ... }

impl AgentManager { ... }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_something() { ... }
}
```
