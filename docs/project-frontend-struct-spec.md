Tauri 2.0 + React + Zustand 桌面端项目架构规范文档

本规范基于 **Bulletproof React** 的业务功能（Feature-based）拆分理念，并结合 **Tauri 2.0** 独有的跨平台桌面端特性定制而成。

🎯 核心设计哲学

1.  **职能清晰**：Rust 后端独占 SQLite 数据库，全权负责数据持久化与底层系统调用；前端 React 负责界面渲染与交互，严禁编写任何 SQL 语句。
2.  **高内聚低耦合**：以 `features` 为核心。一个业务模块所需的组件、状态管理（Zustand）、API 调用（Tauri Invoke）均高内聚在自身文件夹内。
3.  **内存级响应**：Zustand 在前端充当“内存数据库”角色。界面数据流向为：**界面触发 Action ➔ 异步 Invoke 写入底层 SQLite ➔ 成功后更新 Zustand ➔ 界面响应式刷新**。

* * *

🏢 1. 项目整体目录树 (Project Directory Tree)

text

```
my-tauri-app/
├── .tauri/                 # 🦀 Rust 后端与系统原生配置 (Tauri 2.0 核心)
│   ├── src/
│   │   ├── commands/       # 统一管理供前端调用的 Rust 函数 (Commands)
│   │   │   ├── mod.rs
│   │   │   └── finance.rs
│   │   ├── db/             # 🌟 Rust 专属：SQLite 数据库连接、建表、增删改查
│   │   │   ├── mod.rs
│   │   │   └── connection.rs
│   │   └── main.rs         # 后端入口：注册配置与 Commands
│   ├── Cargo.toml          # Rust 依赖包管理 (如 rusqlite, serde 等)
│   └── tauri.conf.json     # Tauri 配置文件 (窗体、权限、捆绑等)
├── src/                    # ⚛️ 前端 React 源代码
│   ├── assets/             # 全局静态资源 (图片、图标、全局样式)
│   ├── components/         # 全局通用基础 UI 组件 (不带业务逻辑)
│   │   ├── Button/         # 基础按钮
│   │   └── TitleBar/       # 🌟 桌面端专属：自定义无边框窗口标题栏
│   ├── config/             # 全局静态配置与常量定义
│   ├── features/           # 🌟 核心：按业务功能模块划分的前端世界
│   │   ├── finance/        # 示例模块：财务记账管理
│   │   └── settings/       # 示例模块：软件通用设置
│   ├── lib/                # 第三方库的统一初始化与封装
│   │   └── tauri.ts        # 封装全局性的 Tauri 事件监听或特殊 API
│   ├── routes/             # 路由配置 (推荐使用 HashRouter 或 MemoryRouter)
│   ├── stores/             # 全局状态管理 (仅存放跨模块的主题、当前登录用户等)
│   ├── types/              # 全局通用 TypeScript 类型定义
│   ├── utils/              # 全局通用工具函数 (日期格式化、数字计算等)
│   ├── App.tsx             # 根组件
│   └── main.tsx            # 前端入口文件
├── package.json            # 前端依赖包管理
└── tsconfig.json           # TypeScript 配置文件
```

请谨慎使用此类代码。

* * *

🌟 2. 核心：src/features (按业务功能拆分)

每个 `feature` 文件夹都应该是一个独立的“微型应用”。外部页面和组件如果要使用该模块的功能，**必须且只能**通过模块根目录下的 `index.ts`（桶文件）引入。

📁 模块内部文件结构（以 `finance` 财务模块为例）

text

```
src/features/finance/
├── api/                    # 🌟 统一调用 Rust 命令层 (不含 SQL 语句)
│   ├── createTransaction.ts# 触发 invoke('create_transaction')
│   └── getTransactions.ts  # 触发 invoke('get_transactions')
├── components/             # 仅供本模块消费的 UI 组件
│   ├── TransactionList.tsx # 记账列表
│   └── FinanceSummary.tsx  # 数据看板
├── stores/                 # 🌟 Zustand 局部状态管理
│   └── useFinanceStore.ts  # 驱动本模块界面的数据流
├── types/                  # 对应本模块的 TypeScript 类型声明
│   └── index.ts            # (结构应与 Rust 的 Struct 完全对齐)
└── index.ts                # 🌟 模块唯一出口文件
```

请谨慎使用此类代码。

🚫 模块隔离与引用规则

+   **禁止跨深度引用**：`pages` 或其他 `features` 绝对不能写形如 `import { X } from '@/features/finance/components/TransactionList'` 的路径。
+   **正确做法**：在 `features/finance/index.ts` 中集中导出：

    typescript

    ```
    // features/finance/index.ts
    export * from './components/TransactionList';
    export * from './stores/useFinanceStore';
    export * from './types';
    ```

    请谨慎使用此类代码。

    外部统一引用：

    typescript

    ```
    import { TransactionList, useFinanceStore } from '@/features/finance';
    ```

    请谨慎使用此类代码。


* * *

💻 3. 前端核心代码规范与示例

📄 3.1 前端 API 层 (`features/finance/api/getTransactions.ts`)

纯粹利用 Tauri 2.0 官方的核心 API 触发后端 Rust 函数，不掺杂任何数据库逻辑。

typescript

```
import { invoke } from '@tauri-apps/api/core';
import { Transaction } from '../types';

/**
 * 从 Rust 后端获取所有账单流
 */
export const getTransactions = async (): Promise<Transaction[]> => {
  try {
    // 触发绑定的 Rust Command
    return await invoke<Transaction[]>('get_all_transactions_command');
  } catch (error) {
    console.error('Tauri Invoke 失败:', error);
    throw error;
  }
};
```

请谨慎使用此类代码。

📄 3.2 Zustand 状态管理 (`features/finance/stores/useFinanceStore.ts`)

Zustand 负责管理内存状态。当组件需要数据时，直接触发 `fetchTransactions`。

typescript

```
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
      // 1. 调用本地 api 层获取 Rust 侧的 SQLite 数据
      const data = await getTransactions();
      // 2. 数据安全写入 Zustand 内存层
      set({ transactions: data });
    } catch (error) {
      console.error('更新 Zustand 状态失败:', error);
    } finally {
      set({ isLoading: false });
    }
  },
}));
```

请谨慎使用此类代码。

* * *

🦀 4. 后端 Rust 对应配合规范 (`.tauri/src`)

为了承接前端的 `invoke` 请求，Rust 后端需要构建稳固的数据模型与命令映射。

📄 4.1 数据模型与命令绑定 (`.tauri/src/commands/finance.rs`)

通过 `serde` 库实现 Rust 结构体与前端 JSON 对象的无缝转换。

rust

```
use serde::{Deserialize, Serialize};

// 🌟 必须衍生 Serialize，否则前端无法解析返回的 JSON
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Transaction {
    pub id: i32,
    pub amount: f64,
    pub category: String,
    pub date: String,
}

// 封装供前端调用的命令
#[tauri::command]
pub async fn get_all_transactions_command() -> Result<Vec<Transaction>, String> {
    // 调用本地的 db 模块读取 SQLite
    match crate::db::get_all_records() {
        Ok(data) => Ok(data),
        Err(err) => Err(format!("数据库查询失败: {}", err)),
    }
}
```

请谨慎使用此类代码。

* * *

🛠️ 5. Tauri 2.0 权限安全配置 (`.tauri/capabilities`)

Tauri 2.0 引入了严苛的 **Capabilities（能力验证）** 体系。前端调用的任何自定义 Rust 命令，必须在安全配置文件中显示放行。

在配置文件中（例如主能力文件 `default.json`），必须对前端暴露自定义命令：

json

```
{
  "$schema": "../bindings/schema.json",
  "identifier": "main-capability",
  "description": "放行前端所需的核心自定义命令",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-close",
    "core:window:allow-center",
    // 🌟 在这里注册你写的自定义 Rust 命令
    "allow-get-all-transactions-command",
    "allow-create-transaction-command"
  ]
}
```

请谨慎使用此类代码。

* * *

📐 6. 桌面端专属研发规范

1.  **绝对就近原则**：
    +   如果一个状态或 Hook 仅在一个 Feature 页面中使用，**坚决不要**写在全局的 `src/stores` 或 `src/hooks` 文件夹中。
    +   如果一个组件只服务于 `TransactionList.tsx`，则直接作为其同级组件存放。
2.  **路由避坑指南**：
    +   **禁止使用**基于浏览器 History API 的 `BrowserRouter`。
    +   **必须使用** `HashRouter` 或 `MemoryRouter`。因为在编译发布后，桌面端本地环境以 `file://` 或特定的本地协议加载页面，传统的单页路由刷新会导致应用白屏或 404。
3.  **命名空间与规范**：
    +   前端组件目录及对应文件采用 **大驼峰 (PascalCase)** 命名，如：`components/TitleBar/TitleBar.tsx`。
    +   状态文件、工具函数、API 脚本采用 **小驼峰 (camelCase)** 命名，如：`useFinanceStore.ts`。
    +   Rust 侧的方法、变量命名遵循 Rust 官方规范采用 **蛇形命名 (snake\_case)**，如：`get_all_transactions_command`。

* * *
