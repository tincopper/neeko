# Tauri 2.0 全栈 Feature-Based / Domain-Driven 架构规范

## 1. 全局设计哲学

1. **领域对齐 (Domain Alignment)**：前端 `src/features/` 与后端 `src-tauri/src/` 在业务模块命名上必须保持 **1:1 绝对对称**。
2. **高内聚，低耦合**：每个功能领域（如 `finance`）必须是一个自包含的闭环。严禁跨模块直接调用私有函数，跨模块通信必须通过全局事件或公共 Service。
3. **单向依赖流**：
    - 前端 UI → 前端 API 层 → Tauri IPC 桥梁 → Rust Commands → Rust Services → Rust Repository → 数据库。
    - 严禁越层调用（例如：UI 组件内严禁直接编写 `invoke` 命令或 SQL 语句）。
4. **单向代码流 (Unidirectional Codebase)**：
    - 共享层 → 特性层 → 应用层，下层严禁反向引用上层。
    - shared/ 可被 features/ 和 app/ 引用，features/ 可被 app/ 引用，反之全禁止。

---

## 2. 全栈大统一项目目录树

```
my-tauri-app/
├── src-tauri/                      # 🦀 Rust 后端世界 (Domain-Driven / Feature 架构)
│   ├── src/
│   │   ├── core/                   # ⚙️ 核心公共层（技术基础设施，不含任何业务逻辑）
│   │   │   ├── mod.rs
│   │   │   ├── db.rs               # 数据库连接池初始化、管理及 Migrations
│   │   │   ├── logger.rs           # 全局日志追踪配置 (如 log/tracing 插件)
│   │   │   └── error.rs            # 统一错误处理（自定义 AppError 并实现 Serialize）
│   │   ├── finance/                # 💰 领域模块 A：财务记账模块
│   │   │   ├── mod.rs              # 模块入口：声明并一键导出本领域的 Commands
│   │   │   ├── model.rs            # 数据结构：纯领域模型/结构体 (与前端 TS 严格对齐)
│   │   │   ├── services.rs         # 【可选】纯业务逻辑层：处理计算、校验、加密 (禁写 SQL)
│   │   │   ├── repository.rs       # 【可选】持久层：负责底层 SQL 语句编写 (禁写 Tauri 上下文)
│   │   │   └── commands.rs         # 接口层：对接前端，解包参数，调用 service 并返回
│   │   ├── settings/               # ⚙️ 领域模块 B：通用设置模块
│   │   │   ├── mod.rs
│   │   │   └── ...
│   │   └── main.rs                 # 🚀 总入口：初始化 core，挂载所有业务领域的 Commands
│   ├── Cargo.toml                  # Rust 依赖配置 (rusqlite, serde, r2d2, tauri 等)
│   └── tauri.conf.json             # Tauri 2.0 窗体与核心能力权限配置
│
├── src/                            # ⚛️ 前端 React 世界 (Feature-Based 架构)
│   ├── app/                        # 组合各 feature 模块（不同 feature 之间不能互相引用，统一在 app 层拼接）
│   ├── assets/                     # 全局静态资源 (图片、字体、全局样式)
│   ├── components/                 # 全局通用基础 UI 组件 (不含业务逻辑，如 Button, TitleBar)
│   ├── config/                     # 全局静态配置 (环境变量、全局常量定义)
│   ├── features/                   # 🧩 核心：按业务功能领域拆分
│   │   ├── finance/                # 📊 前端业务模块 A：财务记账 (与后端完全映射)
│   │   │   ├── api/                # 接口调用：内部触发对应的 invoke('command')
│   │   │   ├── components/         # 局部组件：TransactionList.tsx 等
│   │   │   ├── stores/             # 局部状态：Zustand 驱动本页/本模块数据流
│   │   │   ├── types/              # 类型定义：TypeScript 接口 (与 Rust Struct 对齐)
│   │   │   └── index.ts            # 模块唯一出口：桶文件 (Barrel File)
│   │   └── settings/               # ⚙️ 前端业务模块 B：通用设置 (与后端完全映射)
│   │       └── ...
│   ├── lib/                        # 第三方库初始化
│   │   └── tauri.ts                # 封装全局性的 Tauri 事件监听或底层特殊 API
│   ├── routes/                     # 路由配置 (必须使用 HashRouter 或 MemoryRouter)
│   ├── stores/                     # 全局状态管理 (仅存放跨领域的极少数状态，如主题模式)
│   ├── layout/                     # 布局骨架 (无业务逻辑)
│   ├── types/                      # 全局通用 TypeScript 类型定义
│   ├── utils/                      # 全局通用工具函数 (日期格式化、高精度数字计算等)
│   ├── App.tsx                     # 前端根组件 (挂载 Providers 与 Router)
│   └── main.tsx                    # 前端入口文件
├── package.json                    # 前端依赖配置
└── tsconfig.json                   # TypeScript 配置文件
```

> **结构原则：**
> - 并非每个功能都需要所有这些文件夹，仅包含该功能必需的文件夹。
> - 后端模块最小骨架为 `mod.rs` + `commands.rs`，根据复杂度按需扩展，不一定非要有 `services.rs` 和 `repository.rs`；
> - 前端 feature 子目录按需创建，不强制预埋空白目录；

---

## 3. 前端 ESLint 架构约束

ESLint 负责将 spec 中的架构规则落地为自动化检查，核心思路是 **单向依赖流 + 跨模块隔离 + 命名一致性**。

### 3.1 所需依赖

```bash
pnpm add -D \
  eslint \
  @typescript-eslint/parser \
  @typescript-eslint/eslint-plugin \
  eslint-plugin-import \
  eslint-plugin-react \
  eslint-plugin-react-hooks \
  eslint-plugin-jsx-a11y \
  eslint-plugin-prettier \
  eslint-plugin-check-file \
  eslint-plugin-testing-library \
  eslint-plugin-jest-dom \
  eslint-plugin-tailwindcss \
  eslint-plugin-vitest
```

### 3.2 `.eslintrc.cjs` 完整配置

```js
module.exports = {
  root: true,
  env: {
    node: true,
    es6: true,
  },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  ignorePatterns: [
    'node_modules/*',
    'public/mockServiceWorker.js',
    'generators/*',
  ],
  extends: ['eslint:recommended'],
  plugins: ['check-file'],
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      parser: '@typescript-eslint/parser',
      settings: {
        react: { version: 'detect' },
        'import/resolver': {
          typescript: {},
        },
      },
      env: {
        browser: true,
        node: true,
        es6: true,
      },
      extends: [
        'eslint:recommended',
        'plugin:import/errors',
        'plugin:import/warnings',
        'plugin:import/typescript',
        'plugin:@typescript-eslint/recommended',
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
        'plugin:jsx-a11y/recommended',
        'plugin:prettier/recommended',
        'plugin:testing-library/react',
        'plugin:jest-dom/recommended',
        'plugin:tailwindcss/recommended',
        'plugin:vitest/legacy-recommended',
      ],
      rules: {
        // --- 架构层：禁止跨 feature 引用（映射 spec §1.4 单向代码流 + §7.2 桶文件规范） ---
        'import/no-restricted-paths': [
          'error',
          {
            zones: [
              // feature 之间互相隔离
              { target: './src/features/auth', from: './src/features', except: ['./auth'] },
              { target: './src/features/comments', from: './src/features', except: ['./comments'] },
              { target: './src/features/discussions', from: './src/features', except: ['./discussions'] },
              { target: './src/features/teams', from: './src/features', except: ['./teams'] },
              { target: './src/features/users', from: './src/features', except: ['./users'] },
              // feature 不允许引用 app（单向依赖：app → features）
              { target: './src/features', from: './src/app' },
              // shared 层不允许引用 features 或 app（单向依赖：shared → features/app）
              {
                target: ['./src/components', './src/hooks', './src/lib', './src/types', './src/utils'],
                from: ['./src/features', './src/app'],
              },
            ],
          },
        ],
        // --- 禁止循环引用（映射 spec §1.3 单向依赖流） ---
        'import/no-cycle': 'error',
        // --- 导入顺序强制分组排序 ---
        'import/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object'],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        // --- 文件命名：camelCase；目录命名：kebab-case ---
        'check-file/filename-naming-convention': [
          'error',
          { '**/*.{ts,tsx}': 'CAMEL_CASE' },
          { ignoreMiddleExtensions: true },
        ],
        // --- 其他规则 ---
        'import/default': 'off',
        'import/no-named-as-default-member': 'off',
        'import/no-named-as-default': 'off',
        'react/react-in-jsx-scope': 'off',
        'jsx-a11y/anchor-is-valid': 'off',
        'linebreak-style': ['error', 'unix'],
        'react/prop-types': 'off',
        '@typescript-eslint/no-unused-vars': ['error'],
        '@typescript-eslint/explicit-function-return-type': ['off'],
        '@typescript-eslint/explicit-module-boundary-types': ['off'],
        '@typescript-eslint/no-empty-function': ['off'],
        '@typescript-eslint/no-explicit-any': ['off'],
        'prettier/prettier': ['error', {}, { usePrettierrc: true }],
      },
    },
    // 目录命名：kebab-case（__tests__ 目录除外）
    {
      plugins: ['check-file'],
      files: ['src/**/!(__tests__)/*'],
      rules: {
        'check-file/folder-naming-convention': [
          'error',
          { '**/*': 'KEBAB_CASE' },
        ],
      },
    },
  ],
};
```

### 3.3 规则与 Spec 映射表

| ESLint Rule | 约束对象 | 对应 Spec 条目 |
|---|---|---|
| `import/no-restricted-paths` (zones) | 禁止跨 feature 引用 / 禁止 lower layer 引用 upper layer | §1.4 单向代码流, §7.2 桶文件规范 |
| `import/no-cycle` | 禁止循环依赖 | §1.3 单向依赖流 |
| `import/order` | import 语句分组与排序 | §7.5 命名空间规范 |
| `check-file/filename-naming-convention` | 文件命名强制 camelCase | §7.5 命名空间规范 |
| `check-file/folder-naming-convention` | 目录命名强制 kebab-case | §7.5 命名空间规范 |

> **命名策略**：ESLint `check-file` 文件级 `CAMEL_CASE`，目录级 `KEBAB_CASE`。与 §7.5 保持一致。

---

## 4. Rust Clippy 架构约束

Rust 通过**编译期模块可见性 + Clippy lint + rustfmt** 实现与前端 ESLint 对等的架构约束。

### 4.1 核心原理

| Rust 机制 | 约束能力 | 对等前端工具 |
|---|---|---|
| `pub` / `pub(crate)` / `pub(super)` 可见性修饰 | 编译失败，不是 lint——比 ESLint `no-restricted-paths` 更强 | `import/no-restricted-paths` |
| `Clippy` (`cargo clippy`) | 命名规范、unwrap 禁止、性能、正确性 | ESLint rules |
| `#[deny(...)]` 属性 (`lib.rs`) | crate 级全局禁止特定 lint | `eslint:recommended` |
| `rustfmt` (`cargo fmt`) | 代码格式统一 | Prettier |

### 4.2 `Cargo.toml` Clippy 配置

```toml
[lints.clippy]
# --- 正确性（对应 §7.3 错误冒泡规范）---
unwrap_used = "warn"                  # 禁止 unwrap（生产代码已消除，warn 保留给测试代码）
expect_used = "warn"                  # 允许 expect 但提醒审查
cast_possible_truncation = "deny"     # 禁止隐式数字截断
cast_sign_loss = "deny"               # 禁止有符号→无符号隐式转换
cast_possible_wrap = "deny"           # 禁止可能溢出的转型

# --- 模块可见性（对应 §7.1 横向隔离铁律）---
wildcard_imports = "deny"             # 禁止 glob import（如 use foo::*），防止绕过 visibility
module_inception = "deny"             # 禁止模块嵌套同名目录
needless_pass_by_ref_mut = "deny"     # 提醒不必要的 &mut，缓解共享状态焦虑

# --- 代码质量 ---
missing_docs = "warn"                 # 公开 API 缺失文档
must_use_candidate = "warn"           # 返回值不该被丢弃的函数
missing_const_for_fn = "warn"         # 可常量化的函数
semicolon_if_nothing_returned = "deny"
dbg_macro = "deny"                    # 生产代码禁止 dbg!()
todo = "deny"
print_stdout = "deny"                 # 使用 log 而非 println!
unused_self = "deny"
enum_glob_use = "deny"
fallible_impl_from = "deny"
large_enum_variant = "warn"
cast_lossless = "warn"
manual_string_new = "warn"
unnecessary_wraps = "warn"
redundant_else = "warn"
```

### 4.3 `lib.rs` deny 属性

```rust
// 全局禁止项（在 crate 根模块顶部声明）
#![deny(
    clippy::dbg_macro,
    clippy::todo,
    clippy::print_stdout,
    clippy::wildcard_imports,
    unused_must_use
)]
```

> **未能纳入 deny 的 lints**：
> - `missing_docs`：当前设为 `warn`；代码库中大量公开项缺少文档，需要文档冲刺才能升为 deny。
> - `rust_2018_idioms`：当前 edition 2021 默认已包含；`elided_lifetimes_in_paths` 子 lint 约 46 处违反，需单独清理。

### 4.4 模块可见性约定（落地方案：编译期强制 §7.1）

| 层 | 可见性 | 说明 |
|---|---|---|
| `model.rs` | `pub struct`，字段放开（交给 serde） | 纯数据结构，跨模块可用 |
| `repository.rs` | `pub(crate) fn ...` | 仅 crate 内可见，禁止跨领域直接调用 |
| `services.rs` | `pub(crate) fn ...` | 仅 crate 内可见，是跨 module 调用的唯一入口 |
| `commands.rs` | `pub fn ...`（经 `#[tauri::command]`） | 对前端暴露；跨领域调 service，不直接调 repository |

```rust
// 领域模块 mod.rs
pub mod model;       // pub: 对外暴露数据结构
mod repository;      // pub(crate): 仅本 domain 内部使用
mod services;        // pub(crate): 仅本 domain 内部使用
pub mod commands;    // pub: 对外暴露 Tauri 命令
```

通过 `mod repository`（无 `pub`）限制可见性，**编译期**即可拦截 §7.1 所述的"`settings/repository.rs` 直接查财务表"违规。

### 4.5 CI 集成

```bash
# 与 pnpm lint 同级：Rust 质量门
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

> **建议**：将两行合并入 `package.json` 的 `lint` 脚本，确保 `pnpm lint` 同时覆盖前后端。

---

## 5. 全栈数据流运转模型

应用采用 "无网络架构（Offline-First）" 设计，Zustand 在前端充当高效的"内存缓存层"，数据库/文件在底层负责持久化。

```text
[ React 视图组件 ] → 触发 → [ Zustand Actions ]
                                    │ (异步加载)
                                    ▼
[ 渲染响应式刷新 ] 🏓 拿到 → [ 前端 API (Tauri Invoke) ]
                                    │ (IPC 跨进程通信)
                                    ▼
[ 返回 JSON 数据 ] ◀─── 送回 ── [ Rust Command (接口层) ]
                                    │ (请求数据库池连接)
                                    ▼
                               [ Rust Repository (SQL 层) ] → 读写 → [ 数据库/文件 ]
```

---

## 6. 全栈分层职责与核心代码规范

应用遵循 **"纵向不越级，横向不对齐"** 的分层原则。通过一个完整的"获取财务列表"链路来演示各层的具体实现。

### 6.1 后端 Rust 侧四层模型实现

#### ① 数据模型层 (`finance/model.rs`)

不包含任何逻辑，纯粹定义结构。

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Transaction {
    pub id: i32,
    pub amount: f64,
    pub category: String,
    pub date: String,
}
```

#### ② 持久层 (`finance/repository.rs`)

**唯一允许编写 SQL 的地方**。只负责接收原生 `Connection` 并执行原子级读写。

```rust
use rusqlite::{Connection, Result};
use super::model::Transaction;

pub fn find_all_records(conn: &Connection) -> Result<Vec<Transaction>> {
    let mut stmt = conn.prepare(
        "SELECT id, amount, category, date FROM transactions ORDER BY date DESC"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Transaction {
            id: row.get(0)?,
            amount: row.get(1)?,
            category: row.get(2)?,
            date: row.get(3)?,
        })
    })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}
```

#### ③ 业务逻辑层 (`finance/services.rs`)

**负责处理核心业务**（如：权限校验、加密解密、数据过滤、格式转换）。不关心 Tauri 也不写 SQL。

```rust
use rusqlite::Connection;
use super::model::Transaction;
use super::repository;
use crate::core::error::AppError;

pub fn get_processed_transactions(conn: &Connection) -> Result<Vec<Transaction>, AppError> {
    // 1. 调用持久层拿原数据
    let raw_data = repository::find_all_records(conn)
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // 2. 这里可以编写纯 Rust 业务逻辑（比如过滤敏感分类，或者在这里进行某些计算）
    let processed_data = raw_data.into_iter()
        .filter(|t| t.category != "SENSITIVE_TEST")
        .collect();

    Ok(processed_data)
}
```

#### ④ 接口层 (`finance/commands.rs` & `mod.rs`)

作为胶水层。从 Tauri 上下文解包 `State` 数据库连接池，调用 `service`，并将错误和结果抛回给前端。

```rust
// commands.rs
use tauri::State;
use crate::core::db::DbPool;
use crate::core::error::AppError;
use super::model::Transaction;
use super::services;

#[tauri::command]
pub async fn get_all_transactions_command(
    pool: State<'_, DbPool>
) -> Result<Vec<Transaction>, AppError> {
    let conn = pool.get().map_err(|e| AppError::PoolError(e.to_string()))?;
    services::get_processed_transactions(&conn)
}

// mod.rs (模块总出口)
pub mod model;
pub mod repository;
pub mod services;
pub mod commands;

pub use commands::__cmd__get_all_transactions_command; // 供 main.rs 挂载
```

---

### 4.2 前端 React 侧按业务功能实现

#### ① 接口调用层 (`features/finance/api/getTransactions.ts`)

```typescript
import { invoke } from '@tauri-apps/api/core';
import { Transaction } from '../types';

export const getTransactions = async (): Promise<Transaction[]> => {
  // 仅负责执行 IPC 通信，捕获异常
  return await invoke<Transaction[]>('get_all_transactions_command');
};
```

#### ② Zustand 局部状态管理 (`features/finance/stores/useFinanceStore.ts`)

```typescript
import { create } from 'zustand';
import { Transaction } from '../types';
import { getTransactions } from '../api/getTransactions';

interface FinanceState {
  transactions: Transaction[];
  isLoading: boolean;
  fetchTransactions: () => Promise<void>;
}

export const useFinanceStore = create<FinanceState>((set) => ({
  transactions: [],
  isLoading: false,
  fetchTransactions: async () => {
    set({ isLoading: true });
    try {
      const data = await getTransactions();
      set({ transactions: data });
    } catch (error) {
      console.error('获取财务数据状态失败:', error);
    } finally {
      set({ isLoading: false });
    }
  },
}));
```

---

## 7. 全栈级研发核心高压线（团队协作守则）

1. **横向隔离铁律（后端）**：
    - `settings/` 领域的代码如果需要读取 `finance/` 领域的数据，**绝对禁止**在 `settings/repository.rs` 中直接去查财务表（即严禁跨模块写 SQL）。
    - **正确做法**：引入 `crate::finance::services` 里的公开函数进行跨领域业务调用。

2. **桶文件（Barrel File）规范（前端）**：
    - 前端其他模块如果要引入财务模块的内容，只允许写 `import { ... } from '@/features/finance'`。**绝对禁止**团队成员跨越目录深度写出形如 `from '@/features/finance/components/X'` 的路径。

3. **错误冒泡规范（全栈）**：
    - Rust 底层的原生错误（如 `rusqlite::Error`），必须在 `services.rs` 或 `commands.rs` 这一层通过 `map_err` 拦截并包装为 `core/error.rs` 中前端可读的友好自定义错误，严禁将未捕获的底层崩溃信息抛给前端。

4. **强力禁止浏览器 History 路由**：
    - 前端路由**必须且只能**采用 `HashRouter` 或 `MemoryRouter`。桌面端应用通过本地 `file://` 协议分发资源，传统的 `BrowserRouter` 会导致页面在手动刷新或二级跳转时触发致命的白屏 404。

5. **命名空间与规范**：
    - 前端目录采用 **短横线命名 (kebab-case)**，如：`components/title-bar/`、`features/finance-report/`。
    - 前端文件统一使用 **小驼峰 (camelCase)** 命名，如：`titleBar.tsx`、`useFinanceStore.ts`、`getTransactions.ts`。
    - Rust 侧的方法、变量命名遵循 Rust 官方规范采用 **蛇形命名 (snake_case)**，如：`get_all_transactions_command`。

---

## 8. Neeko 领域映射（实际项目）

> 以下为 Neeko 实际项目的域位置映射。`features/` 对应标准 Feature-Based 域，`app/` 对应应用层组合域。

### 前端域位置

| 业务域 | 位置 | 所属层 | 说明 |
|--------|------|--------|------|
| Agent 管理 | `src/features/agent/` | features | 标准 feature 域 |
| 浏览器集成 | `src/features/browser/` | features | 标准 feature 域 |
| 连接管理 (SSH/WSL) | `src/features/connection/` | features | 标准 feature 域 |
| 文件操作 | `src/features/file/` | features | 标准 feature 域 |
| Git 操作 | `src/features/git/` | features | 标准 feature 域 |
| 项目管理 | `src/features/project/` | features | 标准 feature 域 |
| 会话管理 | `src/features/session/` | features | 标准 feature 域 |
| 设置 | `src/features/settings/` | features | 标准 feature 域 |
| Skill 管理 | `src/features/skill/` | features | 标准 feature 域 |
| Task 管理 | `src/features/task/` | features | 标准 feature 域 |
| 终端 | `src/features/terminal/` | features | 标准 feature 域 |
| 主题 | `src/features/theme/` | features | 标准 feature 域 |
| **编辑器** | **`src/app/editor/`** | **app** | **原位于 features/，后迁至 app 层** |
| 应用壳层 | `src/app/` | app | 组合各 feature 与 app 域 |

### 迁移说明

- 编辑器（Editor）原在 `src/features/editor/`，因架构重构迁至 `src/app/editor/`。此举使 `app/` 层承担部分领域责任，而非仅组合。这是对标准 Feature-Based 架构的有意偏离。
- `app/` 下的域与 `features/` 下的域遵循相同的内部结构（`api/`、`hooks/`、`components/`、`types.ts`），并同样受 ESLint `no-restricted-imports` 约束。
- `app/` 域可引用 `features/` 域，反之禁止。
- **跨域状态下沉**：编辑器的 Zustand store（`useEditorStore`）从 `app/editor/store` 迁至 `shared/store/editorStore`，editor context（`EditorProvider`/`useEditorContext`）迁至 `shared/contexts/editorContext`，`useSplitLayout` 迁至 `shared/hooks/useSplitLayout`。此举解决 features 反向引用 app 的规范违反，使跨域共享状态位于 shared 层，features 可合法引用。
