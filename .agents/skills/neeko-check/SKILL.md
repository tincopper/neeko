---
name: neeko-check
description: Neeko code review
disable-model-invocation: true
---

# Neeko Check

# Neeko代码审查规范

# 核心使命
死守单机 OS 资源底线，捍卫多平台编译一致性，确保 Neeko 长期架构可维护性。

# CoT 内部思考路径 (Chain-of-Thought Internal Reasoning)
在执行任何代码编写、重构或审查命令前，AI 必须在后台经历以下 4 步自检路径：
1. 【物理本质追溯】：当前 PTY 字符流、Git 树节点或 SSH 缓冲区的读写是否会阻塞 Tokio 的 Worker 线程？大吞吐量的 Diff 文本在通过 IPC 传输时是否会造成 V8 引擎反序列化丢帧？
2. 【跨平台边界穿透】：这段代码如果直接在 Windows(WSL适配)、macOS 和 Linux(WebkitGTK依赖) 上编译，是否有未对齐的平台盲区？
3. 【工程契约评估】：它是否严格遵循了 Neeko 的 Feature-Driven Design (FDD) 目录内聚性？它是“胖控制器”吗？核心 Service 能脱离 Tauri 运行时单独测试吗？
4. 【80% 覆盖率追问】：如何编写 Mock 测试隔离 I/O 和外部进程？如何把这个修改模块的覆盖率直接拉满到 80% 以上？

# NEEKO 专属：13大生产级开发与审查维度 (The 13 Pillars)

1. 📂 【前端 FDD 与后端 Domain 混合双驱架构 (Frontend FDD & Backend Domain Architecture)】
    - 【第一性原理】：前端是表现层与用户心智交互的延伸，围绕“功能特征（Feature）”内聚能带来最佳组件复用性；后端是系统核心领域逻辑，必须以“领域模型（Domain, 实体/服务/限界上下文）”为中心，防止跨功能的重复造轮子和底层 OS 原语污染。
    - 【开发硬指标】：
        * **前端（React）FDD 规范**：严格执行 `src/features/[feature-name]/` 规范。每个 Feature 目录下必须内聚其专用的 UI 组件、Custom Hooks 和类型定义。跨 Feature 引用其他特征的非共享逻辑时，必须且只能通过该 Feature 根目录下的 `index.ts`（门面模式）进行显式暴露。
        * **后端（Rust）Domain 规范**：废除后端的 FDD 特征平铺。Rust 目录必须严格按照领域驱动设计组织（如 `src-tauri/src/[domain-name]/` 或采用独立的领域分层模型，包含 `models/`、`services/`、`repositories/`）。
        * **IPC 控制层（Tauri Commands）作为胶水**：`#[tauri::command]` 必须扮演前端 FDD 功能与后端 Rust 领域模型的**跨语言翻译官（Application Layer）**。Command 仅负责接收前端 Feature 的 IPC 请求，参数解构校验后，立即调度底层的统一领域服务（Domain Service）。核心业务逻辑、底层 PTY/SSH 通道抽象一律内聚在领域层（Domain Layer），绝对禁止在控制层（Commands）或 `main.rs` 中平铺。

2. 🧪 【Rust 80% 覆盖率红线与可测试性 (Testing Base)】
    - 【开发硬指标】：新编写的核心业务逻辑（如 Diff 解析算法、Session 持久化、Shell 命令构建）必须具备独立可测试性。严禁让业务层强耦合 `tauri::AppHandle`、`Window` 等无法在 `#[cfg(test)]` 中常驻的实体。AI 在输出修复或代码生成的全过程中，**必须无条件附带测试代码块**，确保整体覆盖率指标。

3. 🔀 【跨平台物理对齐与条件编译 (Cross-Platform OS)】
    - 【开发硬指标】：Neeko 是多端管理器。代码中严禁手动硬编码路径分隔符（`\\` 或 `/`），必须 100% 使用 `PathBuf`。针对 WSL 独占功能（Windows 专用）或特定 Linux 环境依赖，必须使用 `#[cfg(target_os)]` 在同一个 Diff 中一次性完整交出三端适配代码，禁止使用 `// TODO` 敷衍。

4. 🎛️ 【系统托盘与快捷键单机防灾 (Tray & Shortcuts Safety)】
    - 【开发硬指标】：
        * 快捷键：修饰键必须针对 Mac (Command) 和 Win (Control) 进行条件编译。快捷键注册（如 `Ctrl+Alt+T` 唤醒侧端面板）**严禁裸用 .unwrap()**，必须编写 Match 失败分支捕获系统级冲突错误，降级为前端通知，杜绝初始化 Panic 闪退。
        * 托盘：macOS 托盘图标必须采用 `Template` 规范（如 `tray-Template.png`）以支持暗黑模式自动反色。

5. 🌊 【IPC 通道大文本吞吐与 Diff 序列化开销 (IPC & Diff Output)】
    - 【开发硬指标】：Neeko 的 Diff 视图和 PTY 缓冲区会产生巨量文本。严禁在 Command 中单次返回超过 2MB 的复杂 JSON 字符串。大文本传输必须重构为：使用 Tauri 2.0 的二进制流 `Response` 传递 `Vec<u8>`，或者前端通过虚拟滚动列表仅通过 IPC 按需请求截断的数据 ID。

6. 🧠 【单机常驻内存模型与多窗口事件注销 (Memory Leak Prevention)】
    - 【开发硬指标】：Neeko 属于用户高频、常驻应用。频繁读写的全局状态（如 PTY 终端会话映射 `TerminalSessions`）在 Rust 端严禁使用大颗粒全局 `Mutex`，强制采用细脂锁或 `RwLock` 避免线程饥饿。前端在 `useEffect` 中通过 `listen()` 注册的所有 Tauri 全局事件，必须在组件卸载时正确执行返回的 `unlisten` 析构函数，彻底防止 V8 堆内存泄漏。

7. 🧵 【Tokio 异步运行时与 PTY 阻塞线程隔离 (Tokio & PTY Threading)】
    - 【开发硬指标】：在异步 Command 中严禁直接调用任何同步阻塞 I/O（如标准库 `std::fs::read`）或 `portable-pty` 的阻塞读写。此类操作必须无条件包裹进 `tokio::task::spawn_blocking`，将阻塞行为物理隔离到专门的 OS 阻塞线程池中，保护主事件循环不被挂起。

8. 🔒 【本地离线安全沙盒与边界（Sandbox Security）】
    - 【开发硬指标】：Neeko 具有 IDE 启动和 SSH 密钥读取功能。在 `capabilities` 配置中严禁为了图省事放开 `fs:allow-all`、`shell:allow-all`。从前端 React 传入的任何路径（如 Bound IDE 的路径、项目 Root 路径），Rust 端在消费前必须首先使用 `canonicalize()` 进行路径物理化安全校验，严防路径穿越提权漏洞。

9. 🧱 【跨语言模块边界与解耦原则 (Skinny Controller)】
    - 【开发硬指标】：`#[tauri::command]` 必须保持极薄。它作为 IPC 控制器，只允许负责接收参数、基本的反序列化校验和调度下层 Service 模块，不允许直接在 Command 内部平铺实现具体的 Git、SSH 或终端核心控制细节。

10. 🧬 【React 组件高内聚与生命周期隔离 (React Idiomatic)】
    - 【开发硬指标】：前端 UI 组件严禁超过 300 行。严禁在 UI 渲染层裸写 `useEffect` 去触发 `invoke`。所有的 Tauri 后端数据交互，必须统一收拢到自定义 Hooks（如 `useTerminal`）或状态管理器（如 Zustand Action）中，实现 UI 与数据传输层的彻底解耦。

11. 🦀 【Idiomatic Rust 地道规范与 3 层嵌套红线 (If-Let Hierarchy Guard)】
    - 【第一性原理】：Rust 的类型系统具有极强的表达力。`if let` 嵌套超过 3 层（含 3 层）本质上是在用函数式表达强行编写过程式的“右移屎山”，会物理性地破坏环路复杂度。而 1-2 层的 `if let` 则是处理单一快乐路径（Happy Path）的最佳极简方案。
    - 【审查硬指标】：
        * **量化红线**：严禁编写嵌套层数 `>= 3` 层的 `if let` 或 `if let else if` 结构。AI 只要在代码中数出连续 3 个及以上的解构关键字，**必须强制将其全部拍平重构为单个 `match` 语句**。
        * **反向保护 (YAGNI)**：严禁滥用 `match`。对于只有 1 个或 2 个明确的 Happy Path 解构（例如仅仅从 `Option` 中提取一个 Session），**必须优先推行 `if let`**，严禁强行写出带有 `_ => {}` 垃圾占位符的 `match` 块。

12. 🪵 【全栈防御性编程与契约规范 (Defensive Design)】
    - 【开发硬指标】：前后端交互的 Event 字符串名称（例如切换 PTY、Git 刷新事件）严禁在双端各自硬编码。必须在 Rust 端统一定义为常量或枚举，前端通过类型绑定同步。Rust 端反序列化前端参数时必须配置 `#[serde(default)]` 进行物理防御。

13. 🔄 【跨端单源真理与可观测性 (Single Source & Observability)】
    - 【开发硬指标】：前端绝不允许手动声明任何用于对接 IPC 的 TS 类型。必须 100% 覆盖使用 `tauri-specta` 生成的统一 `bindings.ts`。所有 Rust 端的 `panic!`、`.unwrap()` 产生的异常错误，必须正确路由到 `tauri-plugin-log` 的本地滚动日志文件中，以应对离线环境生产问题排查。

14. 🔀 【模块控制枢纽与零业务逻辑规范 (Slim Mod Hub)】
    - 【开发硬指标】：严禁在 `mod.rs`（或与目录同名的根文件，如 `terminal.rs`）内部平铺任何具体的 `fn`（业务函数）、`impl` 块或复杂的结构体字段实现。此文件只允许存在编译器声明（`mod xxx;`）和重新导出（`pub use xxx::*;`）。一旦发现业务实体大括号 `{...}` 必须立刻抽离到同级独立文件（如 `service.rs`、`types.rs`）中。

15. 🧩 【跨平台组织集中化 (Platform Adapter Centralization)】
    - 【第一性原理】：Neeko 是多端桌面应用，平台差异（macOS/Linux/Windows）是**编译期确定**的。若在单个函数体内用 `#[cfg]` 块堆叠多平台实现，遗漏某平台时当前平台编译不报错，只有换平台构建才暴露——这是「换平台才炸」的根因。平台差异必须集中到统一门面，把「每个平台必须有实现」变成**编译期强制**。
    - 【审查硬指标】：
        * **触发条件**：同一接口需在 3 个及以上平台（macOS/Linux/Windows）分别实现时，**必须**抽到 `src-tauri/src/platform/<theme>/`，按「主题优先、平台次之」组织（每个主题一个目录，目录内每平台一个实现文件 `macos.rs`/`linux.rs`/`windows.rs`/`unix.rs`）。
        * **门面强制完整性**：主题 `mod.rs` 必须用 `#[cfg(target_os = "...")] mod xxx;` + `#[cfg(target_os = "...")] pub use xxx::*;` 选择平台实现（`mod` 与 `pub use` **必须同时 cfg 门控**，避免非活动平台模块触发 `dead_code` 警告）。缺一个平台 impl 时，`pub use` 在本机直接报错（而非换平台才暴露）。
        * **业务代码解耦**：业务代码只允许依赖 `platform::<theme>::` 统一接口，**禁止**在函数体内平铺多平台 `#[cfg]` 实现块。
        * **编译期而非运行期**：平台差异坚持编译期 cfg + 每平台文件，**禁止**用运行期 `Box<dyn Trait>` 抽象平台差异（与 pillar 3「跨平台物理对齐」一致，平台差异不是运行期策略）。
        * **纯移动迁移**：迁移只移动位置、统一接口，不改变平台逻辑实现；行为正确性由 CI 三平台矩阵（`.github/workflows/ci.yml` 的 `backend-check`/`backend-test`）兜底。
        * **边界豁免**：平台专属独立模块（`job_object`、`wsl`）、macOS 菜单（`app_menu.rs`）、简单 shell 选择策略，无需抽入 `platform/`。

# 最少样本对照组 (Few-Shot Neeko Exemplar)
AI 在开发或审查 Neeko 项目时，必须严格对照以下演进范式编写代码：

❌ 【坏代码 (Anti-Pattern)】: (只考虑了 Windows、裸用 unwrap 导致快捷键冲突时全应用闪退、无法进行单元测试)
```rust
#[tauri::command]
fn register_terminal_shortcut(app: tauri::AppHandle) {
    // 致命错 1：写死 Mac 修饰键，在 Windows/Linux 上会导致 Neeko 快捷键全面失效
    // 致命错 2：裸用 .unwrap()。一旦 Ctrl+Alt+T 被系统其他软件抢占，Neeko 在启动或切换项目时会瞬间崩溃闪退
    app.global_shortcut().register("Command+Alt+T").unwrap(); 
}
```

can make code evolution like this:

### 📁 [src-tauri/src/terminal/commands.rs] -> [🎛️ 系统托盘与快捷键单机防灾 / 🔀 跨平台物理对齐]

* 🛠️ **物理本质 (第一性原理)**:
  在多任务操作系统中，Neeko 作为常驻桌面管理器，其注册的全局热键（如侧端面板唤醒）属于系统稀缺资源，物理上随时可能被其他正在运行的进程强行抢占。直接使用 `.unwrap()` 处理注册行为，会在碰撞发生时触发操作系统的 Panic 中断，引发 Neeko 全栈进程意外终止（闪退）。此外，快捷键修饰键的硬件映射在跨平台（macOS 与 Win/Linux）环境下的物理布局完全不同。该函数直接依赖 `AppHandle` 导致在持续集成（CI）阶段无法开展脱离前端 Webview 的独立单元测试。

* 🎯 **根治策略**:
    1. 引入条件编译宏 `#[cfg(target_os)]`，实现快捷键修饰键（`Command` vs `Control`）在三大平台上的原生布局自动适配。
    2. 剥离对 `AppHandle` 运行时的强耦合，将快捷键注册行为抽离到面向特征的 `ShortcutRegistry` Trait 中。
    3. 彻底移除危险的 `.unwrap()`，利用 `match` 模式捕获并隔离注册冲突，将其转化为安全的业务错误（`Result`）传导回前端展示，死守单机高稳定性。

* 💻 **极简重构 Diff 与测试确保**:
```diff
+  // 🧱 核心领域层：抽象出解耦的、可进行独立 Mock 测试的特征接口
+  pub trait ShortcutRegistry {
+      fn register_global_key(&self, keys: &str) -> Result<(), ShortcutError>;
+  }

   #[tauri::command]
-  fn register_terminal_shortcut(app: tauri::AppHandle) {
-      app.global_shortcut().register("Command+Alt+T").unwrap();
+  async fn register_terminal_shortcut(
+      registry: tauri::State<'_, Box<dyn ShortcutRegistry + Send + Sync>>
+  ) -> Result<(), CommandError> {
+      #[cfg(target_os = "macos")]
+      let hotkey = "Command+Alt+T";
+      #[cfg(not(target_os = "macos"))]
+      let hotkey = "Control+Alt+T";
+
+      // 🔒 防御性设计：优雅捕获系统资源冲突，拒绝 Panic 闪退
+      registry.register_global_key(hotkey).map_err(|e| {
+          log::error!("Neeko 全局热键 [{}] 注册冲突被强行抢占: {:?}", hotkey, e);
+          CommandError::ShortcutConflict(hotkey.to_string())
+      })?;
+      Ok(())
   }
```
```rust
  // 🧪 80% 覆盖率断言：面向 Neeko 独立特征的纯净单元测试（不依赖 Webview 运行时）
  #[cfg(test)]
  mod tests {
      use super::*;
      struct MockRegistry { simulate_conflict: bool }
      impl ShortcutRegistry for MockRegistry {
          fn register_global_key(&self, _keys: &str) -> Result<(), ShortcutError> {
              if self.simulate_conflict { Err(ShortcutError::Conflict) } else { Ok(()) }
          }
      }
      #[test]
      fn test_neeko_hotkey_conflict_no_panic() {
          let mock = MockRegistry { simulate_conflict: true };
          let result = mock.register_global_key("Control+Alt+T");
          assert!(result.is_err(), "当系统快捷键冲突时，Neeko 应该优雅返回 Error 而非触发 Panic 闪退");
      }
  }
```

# AI 自身防御最高指令 (No Exceptions)
- 【严禁务虚】：禁止给出任何不带代码实体的概念性回答。
- 【平台零容忍】：只要修改或编写的代码涉及本地 PTY 终端读写、SSH、文件监控、系统路径或视窗操作，**必须同时提供针对 Windows/macOS/Linux 的全套适配代码**。
- 【测试与覆盖率拦截】：只要涉及任何 Rust 核心业务的改动，**不附带单元测试/Mock 测试的回答一律视为无效输出**，以此死守 Neeko 项目 >=80% 覆盖率红线。