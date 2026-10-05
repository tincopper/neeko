---
name: neeko-check
description: Neeko code review — 代码审核器，判定代码是否符合项目规范（现行 15 条红线）、业界 React/Rust 最佳实践与架构设计。用于提交前审查、PR 审查、或对指定代码进行规范审核。
disable-model-invocation: true
---

# Neeko Check

# Neeko 代码审核规范（Code Reviewer）

> **术语纪律（硬指令）**：本项目审查**只用「红线」**。旧 neeko-check「支柱 / Pillar」体系
> （13/15 条、编号与本表不同）已**废止**（根 `AGENTS.md`「AI 代码审查红线」明文）。本 skill
> 内一律按**现行 15 条红线编号**引用；不得再出现「支柱 / Pillar」作为规则名。

> **定位**：审核代码是否符合三层标准：
> 1. **项目规范** —— 15 条红线（全文按代码物理边界分文件存放；根 `AGENTS.md` 的红线索引表是唯一台账）
> 2. **业界最佳实践** —— `docs/best-practices/index.md`（React / Rust / 通用工程）
> 3. **架构设计** —— 根 `AGENTS.md`「架构基本原则（强制）」

> **按改动所在侧取红线全文，否则等于漏审**：
> - 跨栈红线 **4 / 5 / 14** 全文在根 `AGENTS.md`；
> - 后端红线 **1、2、3、6、7、8、9、10、11、13、15** 全文在 `src-tauri/AGENTS.md`；
> - 前端红线 **12** 全文在 `src/AGENTS.md`。
>
> 审核 `src-tauri/**` 前必须读 `src-tauri/AGENTS.md`；审核 `src/**` 前必须读 `src/AGENTS.md`。
> 以**编号**定位规则，不要按标题文字猜。标准缺失时提示补到对应 `AGENTS.md`，不在本 skill 内新增规则。

# 核心使命
死守单机 OS 资源底线，捍卫多平台编译一致性，确保 Neeko 长期架构可维护性。

---

# 审核流程

## Step 0：确定审核范围（增量 / 全量）

1. 运行 `git status --short` 与 `git diff --name-only HEAD`，判断是否有未提交 / 已暂存改动。
2. **有改动** → 走【增量审核】：
   - 只对改动文件应用相关红线与最佳实践，不扫描全库。
   - 除非用户明确说「全量审核 / 检查整个项目 / full check」，否则不得扩大范围。
3. **无改动**（工作树干净）→ 走【全量审核】：对全库应用全部红线与最佳实践。
4. 报告开头必须标注：`模式：增量（N 个文件）` 或 `模式：全量`。

## Step 1：载入落点文件

- 根 `AGENTS.md`：红线索引表 + 架构基本原则（强制）。
- 改动涉及 `src-tauri/**` → 读 `src-tauri/AGENTS.md`（该侧全部红线全文）。
- 改动涉及 `src/**` → 读 `src/AGENTS.md`（红线 12 全文 + 导入防火墙 / 状态管理）。
- 需要机制依据时按需载入 `.trellis/spec/{backend,frontend,security,unit-test}/`。

## Step 2：逐条核对 15 条红线

按下方「15 条红线导航表」定位相关红线，**回落到点文件读全文**再判定；缺审查项即等于漏审。

## Step 3：架构与最佳实践

- 架构基本原则：高内聚低耦合 / 单一职责 / 依赖倒置 / 开闭原则 / DRY / KISS / YAGNI。
- 业界最佳实践：`docs/best-practices/index.md` 索引下的 React / Rust / 通用工程文件。
- 前端专属：Feature-Based 目录内聚 + 导入防火墙（`src/AGENTS.md`）。
- 后端专属：Domain-Driven 目录 + Skinny Command（`src-tauri/AGENTS.md`）。

## Step 4：按模板输出报告

---

# 15 条红线导航表

> 全文以 `AGENTS.md` 为准，本表只做**定位与摘要**（够用来识别并停止违规）。判据与例外一律回落到点文件。

| # | 红线 | 必须 / 禁止（摘要） | 全文落点 |
| --- | --- | --- | --- |
| 1 | 统一命令执行接口（Local/WSL/SSH） | 命令只走 `core::exec` / `common::executor`，禁止直接用 `std::process::Command` | `src-tauri/AGENTS.md` |
| 2 | 跨平台 shell 选择（`cmd /c` vs `sh -c`） | Local 按平台选 shell，禁止硬编码 `sh -c` / `bash -lc` | `src-tauri/AGENTS.md` |
| 3 | 阻塞 I/O 隔离（`spawn_blocking`） | 异步中 `std::fs` / `std::process` / portable-pty 阻塞读写必须包 `spawn_blocking` | `src-tauri/AGENTS.md` |
| 4 | IPC 大文本边界 | 单次 Command 返回 JSON ≤ 2MB；大载荷走二进制流 / 分页 | 根 `AGENTS.md` |
| 5 | Event 名常量化 | Event 名双端只来自单一常量源，禁止各自硬编码 | 根 `AGENTS.md` |
| 6 | Command 层保持极薄 | `#[tauri::command]` 只做参数校验 + 调度，核心逻辑落 manager/service | `src-tauri/AGENTS.md` |
| 7 | `if let` 嵌套不超过 3 层 | ≥3 层连续解构拍平成 `match`；仅 1–2 条 happy path 才用 `if let` | `src-tauri/AGENTS.md` |
| 8 | 路径安全校验（`canonicalize` + capabilities 白名单） | 前端传入路径消费前必须 `canonicalize`；capabilities 禁止 allow-all | `src-tauri/AGENTS.md` |
| 9 | `mod.rs` 保持极薄 | `mod.rs` 只允许 `mod` 声明 + `pub use`，业务 `fn` / `impl` 抽同级文件 | `src-tauri/AGENTS.md` |
| 10 | 平台代码规范化（Platform Adapter） | 平台差异与单平台代码必须落 `platform/<theme>/`，通用文件禁止平铺 `#[cfg]` | `src-tauri/AGENTS.md` |
| 11 | 换行边界（Line-Ending Boundary） | 禁止注入 `core.autocrlf`；禁止对工作区换行做字节级断言 | `src-tauri/AGENTS.md` |
| 12 | 路径身份唯一化（`FileRef`） | 同文件判定必须走 `FileRef`，禁止消费侧自造字符串归一 / 别名匹配 | `src/AGENTS.md` |
| 13 | 测试夹具路径平台无关 | 夹具路径一律由 `tempdir()` 推导，禁止硬编码 POSIX 绝对路径 | `src-tauri/AGENTS.md` |
| 14 | LSP 能力声明必须与实现一致 | 声明客户端能力前先确定消费点，同一 diff 内给出实现或删声明 | 根 `AGENTS.md` |
| 15 | 语言差异必须落在插件数据 | 语言差异只允许作为 `LspPlugin` 字段，通用模块禁止 `language_id` 分支 | `src-tauri/AGENTS.md` |

---

# 跨平台判定器（Cross-Platform Trigger）

> 先判定改动是否涉及跨平台。命中任一信号 → 必须执行下方【跨平台验证清单】，并重点核对
> 红线 2 / 10 / 13（必要时 15）。

【路径信号】
- 改动位于 `src-tauri/src/platform/**`（适配器目录）
- 出现 `#[cfg(target_os)]` / `#[cfg(not(target_os))]` / `#[cfg(windows)]` 等条件编译
- 涉及路径拼接、分隔符、`PathBuf` / `Path`、硬编码 `\\` 或 `/`

【OS 原语信号】
- PTY / 终端读写、SSH、WSL 分发
- 进程启动 / 杀死（`std::process`、`Command`）、进程树、job object
- 文件系统监控（watcher）、symlink、reveal（在文件管理器中显示）
- 系统托盘、全局快捷键、菜单
- IDE 启动、shell 启动、host_path（路径映射）
- 文件 URL、git credential、devtools

【前端信号】
- 快捷键修饰键（Command vs Control）
- 平台路径处理、`navigator.platform` / `@tauri-apps/api` 平台判断

# 跨平台验证清单（对齐红线 2 / 10 / 13）

1. **路径**：100% 使用 `PathBuf` / `Path`，禁止硬编码分隔符（红线 2 / 13）。
2. **集中化**：同一接口需 3 平台实现时，必须抽到 `src-tauri/src/platform/<theme>/`，禁止在函数体内平铺多平台 `#[cfg]` 块（红线 10）。
3. **门面完整性**：`platform/<theme>/mod.rs` 的 `mod xxx;` 与 `pub use xxx::*;` **必须同时** `#[cfg(target_os)]` 门控（红线 10）。
4. **编译期而非运行期**：平台差异用编译期 cfg + 每平台文件，禁止用 `Box<dyn Trait>` 抽象平台差异（红线 10 / 15）。
5. **三端适配完整**：改动若涉及 PTY / SSH / 路径 / 视窗，必须一次性交出 Windows / macOS / Linux 全套适配代码，禁止 `// TODO` 敷衍（红线 10）。
6. **本地局限声明**：本地只能编译当前平台，其余平台编译正确性由 CI 三平台矩阵（`.github/workflows/`）兜底 —— 审查结论中注明「其余平台需 CI 验证」。
7. **边界豁免**：`job_object`、`wsl`、macOS 菜单（`app_menu.rs`）、简单 shell 选择策略，无需抽入 `platform/`。

---

# 架构与最佳实践核对（维度）

## 维度 A：项目规范（15 条红线）
见上方导航表；逐条回落到点文件核对。

## 维度 B：业界最佳实践（`docs/best-practices/index.md`）
- **React**：类型安全（禁 `any`）、组件 ≤300 行、数据流收拢到 hooks / Zustand、副作用清理（`listen` 必须 `unlisten`）、渲染性能（`useMemo` / `useCallback` / `React.memo`）、key 稳定性、受控组件。
- **Rust**：错误处理（`thiserror` + `?` 传导、禁吞错）、所有权与借用（避免滥用 `.clone()`）、命名与文档、并发（避免跨 `await` 持锁、阻塞 I/O 隔离）、类型驱动（`enum` + `match` 编译期分派）。
- **通用**：可读性、魔法数字提取常量、DRY / KISS / YAGNI、无死代码。

## 维度 C：架构设计（根 `AGENTS.md` 架构基本原则）
- 高内聚低耦合：模块职责单一，跨域经明确接口（API wrapper / `pub use` / props/context）通信，禁止跨域直接引用内部实现。
- 开闭原则：新增功能通过新代码扩展（新 variant / 新 strategy / 新组件），而非改核心逻辑。
- 前端 FDD / 后端 Domain 目录内聚；导入防火墙（`src/AGENTS.md`）。
- 依赖倒置：高层依赖抽象，不依赖具体实现。
- 是否「胖控制器」；核心 Service 能否脱离 Tauri 运行时单独测试。

---

# CoT 内部思考路径 (Chain-of-Thought Internal Reasoning)

> 审核任何代码前，必须在后台经历以下 4 步自检：

1. 【物理本质追溯】：当前 PTY 字符流、Git 树节点或 SSH 缓冲区的读写是否会阻塞 Tokio worker？大吞吐 Diff 文本经 IPC 是否触发红线 4？
2. 【跨平台边界穿透】：这段代码在 Windows(WSL) / macOS / Linux 上是否都有对齐实现？（联动上方【跨平台判定器】，红线上限 2/10/13）
3. 【工程契约评估】：是否遵循前端 FDD / 后端 Domain 的目录内聚？它是「胖控制器」吗（红线 6）？核心 Service 能脱离 Tauri 运行时单独测试吗？
4. 【测试与覆盖率追问】：如何用测试隔离 I/O 与外部进程？新增核心逻辑是否都有直测（见根 `AGENTS.md`「TDD 开发模式」）？

---

# 审核报告格式（Report Format）

```text
### 🔍 审核报告

- **模式**：增量（N 个文件） / 全量
- **跨平台判定**：涉及 / 不涉及（命中信号：...）
- **审核维度**：项目规范（红线）/ 业界最佳实践 / 架构设计

### 🚫 违规清单（Block / Warning / Nit）
- [Block] `文件:行号` → 红线编号 / 维度 → 问题描述 → 修复建议
- [Warning] ...
- [Nit] ...

### ✅ 合规确认
- 已确认符合的红线 / 维度

### 🧪 测试
- 新增核心逻辑是否附带测试（对齐根 `AGENTS.md`「TDD 开发模式」）
- 跨平台改动：其余平台需 CI 验证（如涉及）
```

---

# AI 自身防御最高指令 (No Exceptions)

- 【严禁务虚】：禁止给出任何不带代码实体的概念性回答。
- 【平台零容忍】：只要修改或编写的代码涉及本地 PTY 读写、SSH、文件监控、系统路径或视窗操作，**必须同时提供 Windows / macOS / Linux 全套适配代码**（红线 2 / 10）。
- 【测试拦截】：只要涉及核心业务逻辑改动，**不附带单元测试 / Mock 测试的回答一律视为无效输出**（根 `AGENTS.md`「TDD 开发模式」）。
- 【编号纪律】：引用规则一律用**红线编号**；不得复活「支柱 / Pillar」体系。
