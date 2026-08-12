---
name: neeko-check
description: Neeko code review — 代码审核器，判定代码是否符合项目规范、业界 React/Rust 最佳实践与架构设计。用于提交前审查、PR 审查、或对指定代码进行规范审核。
disable-model-invocation: true
---

# Neeko Check

# Neeko 代码审核规范（Code Reviewer）

> **定位**：本 skill 是**代码审核器**，审核代码是否符合三层标准：
> 1. **项目规范** —— `AGENTS.md`（单一事实源）+ 下方 15 大 pillar
> 2. **业界最佳实践** —— `AGENTS.md` 中「业界最佳实践（React / Rust 通用底线）」章节
> 3. **架构设计** —— `AGENTS.md` 架构基本原则 + 15 大 pillar
>
> 审核标准以 `AGENTS.md` 为单一事实源，本 skill 负责**引用并对齐**，不重复定义标准。
> 若审核中发现标准缺失，应提示补充到 `AGENTS.md`，而非在本 skill 内新增规则。

# 核心使命
死守单机 OS 资源底线，捍卫多平台编译一致性，确保 Neeko 长期架构可维护性。

---

# Step 0：确定审核范围（增量 / 全量）

> 审核动作前必须先确定范围，避免误扫全库或漏审改动。

1. 运行 `git status --short` 与 `git diff --name-only HEAD`，判断当前是否有未提交 / 已暂存的改动文件。
2. **有改动文件** → 走【增量审核】：
   - 只对改动文件应用相关 pillar 与最佳实践，不扫描全库。
   - 除非用户明确说「全量审核 / 检查整个项目 / full check」，否则不得扩大范围。
3. **无改动文件**（工作树干净）→ 走【全量审核】：对全库应用全部 pillar 与最佳实践。
4. 审查报告开头必须标注模式：`模式：增量（N 个文件）` 或 `模式：全量`。

---

# 跨平台判定器（Cross-Platform Trigger）

> 审核时先判定改动是否涉及跨平台。命中任一信号 → 判定「涉及跨平台」，必须执行下方【跨平台验证清单】。

【路径信号】
- 改动文件位于 `src-tauri/src/platform/**`（适配器目录）
- 改动文件出现 `#[cfg(target_os)]` / `#[cfg(not(target_os))]` / `#[cfg(windows)]` 等条件编译
- 改动涉及路径拼接、分隔符、`PathBuf` / `Path` / 硬编码 `\\` 或 `/`

【OS 原语信号】改动涉及以下任一能力：
- PTY / 终端读写、SSH、WSL 分发
- 进程启动 / 杀死（`std::process`、`Command`）、进程树、job object
- 文件系统监控（watcher）、symlink、reveal（在文件管理器中显示）
- 系统托盘、全局快捷键、菜单
- IDE 启动、shell 启动、host_path（路径映射）
- 文件 URL、git credential、devtools

【前端信号】
- 快捷键修饰键（Command vs Control）
- 平台路径处理、`navigator.platform` / `@tauri-apps/api` 平台判断

# 跨平台验证清单（Cross-Platform Verification）

命中跨平台判定后，逐项核对（对齐 pillar 3 / 15）：

1. **路径**：100% 使用 `PathBuf` / `Path`，禁止硬编码分隔符。
2. **集中化**：同一接口需 3 平台实现时，必须抽到 `src-tauri/src/platform/<theme>/`，禁止在函数体内平铺多平台 `#[cfg]` 块。
3. **门面完整性**：`platform/<theme>/mod.rs` 的 `mod xxx;` 与 `pub use xxx::*;` **必须同时** `#[cfg(target_os)]` 门控。
4. **编译期而非运行期**：平台差异用编译期 cfg + 每平台文件，禁止 `Box<dyn Trait>` 抽象平台差异。
5. **三端适配完整**：改动若涉及 PTY/SSH/路径/视窗，必须一次性交出 Windows/macOS/Linux 全套适配代码，禁止 `// TODO` 敷衍。
6. **本地局限声明**：本地只能编译当前平台，其余平台编译正确性由 CI 三平台矩阵（`.github/workflows/ci.yml` 的 `backend-check`/`backend-test`）兜底——审查结论中注明「其余平台需 CI 验证」。
7. **边界豁免**：`job_object`、`wsl`、macOS 菜单（`app_menu.rs`）、简单 shell 选择策略，无需抽入 `platform/`。

---

# 审核维度（Review Dimensions）

> 按「增量 / 全量」模式，对改动文件（或全库）逐项核对以下三个维度。

## 维度 A：项目规范（对齐 AGENTS.md + 15 大 pillar）

- 架构基本原则：高内聚低耦合、模块导入/导出防火墙、开闭原则、DRY/KISS/YAGNI、状态管理。
- AI 代码审查红线（Review Gates）：统一命令执行接口、跨平台 shell 选择、阻塞 I/O 隔离、IPC 2MB、Event 常量化、Skinny Command、if-let 嵌套、路径安全、Slim mod.rs。
- 下方 15 大 pillar 逐条核对。

## 维度 B：业界最佳实践（对齐 `docs/best-practices/index.md`）

- 通过索引定位规范文件：`docs/best-practices/react.md`、`rust.md`、`general.md`。
- **React**：类型安全（禁 `any`）、组件 ≤300 行、数据流收拢到 hooks/Zustand、hook 命名与副作用清理、渲染性能（`useMemo`/`useCallback`/`React.memo`）、key 稳定性、受控组件。
- **Rust**：错误处理（`thiserror` + `?` 传导、禁吞错）、所有权与借用（避免滥用 `.clone()`）、命名与文档、并发（避免跨 await 持锁、阻塞 I/O 隔离）、类型驱动（`enum` + `match`）。
- **通用**：可读性、魔法数字提取常量、DRY/KISS/YAGNI、无死代码。

## 维度 C：架构设计（对齐 AGENTS.md 架构基本原则 + 15 大 pillar）

- 高内聚低耦合：模块职责单一，跨域通过接口/门面通信，禁止跨域直接引用内部实现。
- 开闭原则：新增功能通过新代码扩展，而非修改核心逻辑。
- FDD（前端）/ Domain（后端）目录内聚性。
- 依赖倒置：高层依赖抽象，不依赖具体实现。
- 是否存在「胖控制器」；核心 Service 能否脱离 Tauri 运行时单独测试。

---

# 审核报告格式（Report Format）

> 审核完成后，按以下模板输出报告。

```text
### 🔍 审核报告

- **模式**：增量（N 个文件） / 全量
- **跨平台判定**：涉及 / 不涉及（命中信号：...）
- **审核维度**：项目规范 / 业界最佳实践 / 架构设计

### 🚫 违规清单（Block / Warning / Nit）
- [Block] `文件:行号` → pillar/维度 → 问题描述 → 修复建议
- [Warning] ...
- [Nit] ...

### ✅ 合规确认
- 已确认符合的 pillar / 维度

### 🧪 覆盖率
- 新增核心逻辑是否附带单元测试 / Mock 测试（≥80% 红线）
- 其余平台需 CI 验证（如涉及跨平台）
```

---

# CoT 内部思考路径 (Chain-of-Thought Internal Reasoning)

> 审核任何代码前，AI 必须在后台经历以下 4 步自检路径：

1. 【物理本质追溯】：当前 PTY 字符流、Git 树节点或 SSH 缓冲区的读写是否会阻塞 Tokio 的 Worker 线程？大吞吐量的 Diff 文本在通过 IPC 传输时是否会造成 V8 引擎反序列化丢帧？
2. 【跨平台边界穿透】：这段代码如果直接在 Windows(WSL适配)、macOS 和 Linux(WebkitGTK依赖) 上编译，是否有未对齐的平台盲区？（联动上方【跨平台判定器】）
3. 【工程契约评估】：它是否严格遵循了 Neeko 的 Feature-Driven Design (FDD) 目录内聚性？它是「胖控制器」吗？核心 Service 能脱离 Tauri 运行时单独测试吗？
4. 【80% 覆盖率追问】：如何编写 Mock 测试隔离 I/O 和外部进程？如何把这个修改模块的覆盖率直接拉满到 80% 以上？

---

# NEEKO 专属：15 大生产级开发与审查维度 (The 15 Pillars)

> 项目特有规范，审核时逐条核对（增量模式下仅对命中改动文件的 pillar 生效）。

1. 📂 【前端 FDD 与后端 Domain 混合双驱架构 (Frontend FDD & Backend Domain Architecture)】
   - 【第一性原理】：前端是表现层与用户心智交互的延伸，围绕「功能特征（Feature）」内聚能带来最佳组件复用性；后端是系统核心领域逻辑，必须以「领域模型（Domain, 实体/服务/限界上下文）」为中心，防止跨功能的重复造轮子和底层 OS 原语污染。
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
    - 【第一性原理】：Rust 的类型系统具有极强的表达力。`if let` 嵌套超过 3 层（含 3 层）本质上是在用函数式表达强行编写过程式的「右移屎山」，会物理性地破坏环路复杂度。而 1-2 层的 `if let` 则是处理单一快乐路径（Happy Path）的最佳极简方案。
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

---

# AI 自身防御最高指令 (No Exceptions)

- 【严禁务虚】：禁止给出任何不带代码实体的概念性回答。
- 【平台零容忍】：只要修改或编写的代码涉及本地 PTY 终端读写、SSH、文件监控、系统路径或视窗操作，**必须同时提供针对 Windows/macOS/Linux 的全套适配代码**。
- 【测试与覆盖率拦截】：只要涉及任何 Rust 核心业务的改动，**不附带单元测试/Mock 测试的回答一律视为无效输出**，以此死守 Neeko 项目 >=80% 覆盖率红线。
