Tauri 2.0 + React 模块化项目开发规范

一、 全局设计哲学

1.  **领域对齐 (Domain Alignment)**：前端 `src/features/` 与后端 `.tauri/src/` 在业务模块命名上必须保持 **1:1 绝对对称**。
2.  **高内聚，低耦合**：每个功能领域（如 `finance`）必须是一个自包含的闭环。严禁跨模块直接调用私有函数，跨模块通信必须通过全局事件或公共 Service。
3.  **单向依赖流**：
    +   前端 UI ➔ 前端 API 层 ➔ Tauri IPC 桥梁 ➔ Rust Commands ➔ Rust Services ➔ Rust Repository ➔ 数据库。
    +   严禁越层调用（例如：UI 组件内严禁直接编写 `invoke` 命令或 SQL 语句）。

* * *

二、 🦀 后端 Rust 规范 (`.tauri/src/`)

1\. `core/` 核心公共层规范

+   **`db.rs`**：负责初始化数据库连接池（如 `r2d2` + `rusqlite`）。通过 `tauri::AppHandle` 或 `tauri::State` 向外注入连接池，**不写任何具体业务 SQL**。
+   **`error.rs`**：统一应用错误。必须实现 `serde::Serialize`。所有 Command 的返回值必须是 `Result<T, AppError>`，确保前端能捕获清晰的报错信息。
+   **`logger.rs`**：配置日志分级输出（如 `tauri-plugin-log`），规范生产环境与开发环境的日志落盘。

2\. `domains/<feature>/` 领域模块规范

每个独立的业务领域文件夹内，代码必须严格拆分为 5 个文件，职责划分如下：

| 文件名 | 职责  | 访问权限约束 |
| --- | --- | --- |
| `mod.rs` | 模块总入口。负责声明子模块，并统一导出当前领域的 `commands`。 | 仅对 `main.rs` 暴露 |
| `commands.rs` | 接口层。只负责接收前端 `invoke` 请求、解析参数、调用 `services`。 | 必须带 `#[tauri::command]` |
| `services.rs` | 业务逻辑层。处理复杂的业务计算、数据校验、权限审计等核心逻辑。 | 严禁出现底层 SQL 语句 |
| `repository.rs` | 持久化层。**唯一允许编写 SQL 的地方**。负责从数据库增删改查并返回 Model。 | 仅对 `services.rs` 开放 |
| `model.rs` | 数据模型层。定义与数据库表结构对应的 Struct，以及传输用的 DTO。 | 必须派生 `Serialize, Deserialize, TS` |

3\. 后端命名与代码示例

+   **命名规范**：文件和包名使用 `snake_case`，结构体使用 `CamelCase`，Command 函数名使用 `snake_case`。
+   **代码隔离示例 (`commands.rs`)**：

rust

```
// ❌ 错误示范：在 Command 里写业务和 SQL
#[tauri::command]
pub fn create_record(amount: f64) { ... sql_query("INSERT...") }

//  正确示范：Command 仅作为胶水层转发
#[tauri::command]
pub async fn create_record(
    amount: f64, 
    state: tauri::State<'_, DbPool>
) -> Result<Record, AppError> {
    // 1. 调用业务层验证
    let clean_amount = finance::services::validate_amount(amount)?;
    // 2. 调用持久层写入
    let record = finance::repository::insert_record(clean_amount, &state)?;
    Ok(record)
)
```

请谨慎使用此类代码。

* * *

三、 ⚛️ 前端 React 规范 (`src/`)

1\. 核心路由约束

+   **禁止使用 `BrowserRouter`**！由于桌面端应用基于本地静态文件（`file://` 协议）加载，刷新页面会导致 404。
+   **必须使用** `HashRouter` 或 `MemoryRouter`。

2\. `features/<feature>/` 业务模块规范

前端按功能拆分的模块内部，结构和职责如下：

+   **`api/`**：统一存放与后端 Rust 通信的函数。统一使用 `invoke`，严禁在 UI 组件中散落 `invoke` 代码。
+   **`components/`**：仅存放**当前业务专属**的私有组件（如 `TransactionList.tsx`）。如果是多页面复用的组件，必须上浮到全局 `src/components/`。
+   **`stores/`**：使用状态管理工具（如 `Zustand`）驱动本业务内的数据流。页面刷新、数据暂存均在此处理。
+   **`types/`**：定义 TypeScript 的 `interface`。这里的类型必须与 Rust `model.rs` 中的结构体定义**严格保持一致**。
+   **`index.ts`（桶文件）**：模块的唯一对外窗口。只有通过 `index.ts` 导出的组件、函数，才能被模块外部（如路由或其他 feature）引用。

3\. 前端命名与代码示例

+   **命名规范**：组件和类型文件使用 `PascalCase`，普通逻辑文件与文件夹使用 `camelCase`。
+   **代码隔离示例 (`api/finance.ts`)**：

typescript

```
import { invoke } from '@tauri-apps/api/core';
import type { Record, CreateRecordPayload } from '../types';

// 统一在此处封装，方便后续类型推导或单测 Mock
export async function createRecordApi(payload: CreateRecordPayload): Promise<Record> {
  try {
    return await invoke<Record>('create_record', { ...payload });
  } catch (error) {
    console.error("财务模块通信失败:", error);
    throw error;
  }
}
```

请谨慎使用此类代码。

* * *

四、 🔗 跨端通信与类型安全规范

1\. 类型自动同步（强烈推荐）

为了防止 Rust 的 Struct 修改了，而前端 TS 类型忘记修改导致崩溃，团队必须使用自动生成工具：

+   在 Rust 端引入 `ts-rs` 库。
+   在 Rust 的数据结构上打上 `#[derive(TS)]` 和 `#[ts(export)]` 标签。
+   运行 `cargo test` 时，会自动在前端生成 `.ts` 类型文件，前端 `types/` 目录只需建立软链接或直接引用生成的文件即可。

2\. Tauri 2.0 权限安全 (Capabilities)

+   严禁将所有权限堆放在 `default.json` 中。
+   必须在 `src-tauri/capabilities/` 目录下，为每个领域创建对应的权限文件（如 `finance.json`）。
+   新增 `#[tauri::command]` 后，必须**同步**在对应的权限 JSON 文件中显式放行（如 `"permissions": ["main:create_record"]`），否则前端调用将被拦截。

* * *

五、 📋 新人克隆/新建模块 CheckList

当你需要新写一个业务模块（例如开发“消息通知模块 `notifications`”）时，请依次完成以下步骤：

1.  **后端**：在 `src-tauri/src/domains/` 下新建 `notifications/` 文件夹及 5 个基础文件。
2.  **后端**：在 `domains/notifications/mod.rs` 中注册命令，并在 `lib.rs` 中一键挂载。
3.  **权限**：在 `capabilities/` 下新建 `notifications.json`，放行新增的 Command。
4.  **前端**：在 `src/features/` 下新建 `notifications/` 文件夹及 5 个标准子目录。
5.  **前端**：在 `features/notifications/index.ts` 中导出核心组件，并在 `src/routes/` 中挂载该模块的路由。

* * *
