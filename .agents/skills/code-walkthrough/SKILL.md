---
name: code-walkthrough
description: 与用户共同阅读 Neeko 代码，逐层讲解 Tauri 应用架构与跨端数据流。支持三域分层模式（Rust 后端 / React 前端 / 跨端桥接）和调用链追踪模式（含跨端追踪）。主动发现 dead code、设计偏差、类型不一致、迁移遗漏，但不修改代码。Use when user wants to walkthrough code, understand architecture, trace call chains, review a module's structure, or says "过代码" / "walkthrough" / "walk me through" / "zoom out".
---

# Code Walkthrough

与用户共同阅读 Neeko 代码，逐文件讲解 Tauri 应用架构、跨端数据流与设计决策。纯讲解 + 审查，不修改代码。

---

## 核心原则

1. **先全景再深入** -- 先建立模块全局地图，再逐文件探索；不知道全貌就不知道该看什么
2. **逐文件推进** -- 每次只读一个文件，讲完要点、确认用户无问题后再继续，不批量扫
3. **证据驱动** -- 所有讲解必须引用具体文件路径和行号，不凭印象说话
4. **主动审查** -- 阅读过程中主动标注 dead code、设计偏差、类型不一致、迁移遗漏，但不修改代码
5. **交互确认** -- 每个文件讲完后等用户确认，用户有疑问优先解答再继续
6. **用户主导节奏** -- 用户说"继续"才到下一个文件，用户说"看看这个"就切换焦点
7. **双端意识** -- 始终关注 Rust 后端与 React 前端的契约关系，标注跨端依赖

---

## Neeko 架构概览

Neeko 是基于 **Tauri 2 + React 18** 的桌面应用。代码分为三个域：

```
┌─────────────────────────────────────────────────────────────────┐
│                         React 前端 (src/)                        │
│  components/ → hooks/ → store/ ← contexts/ ← types.ts          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ @tauri-apps/api/core.invoke()
                            │ Tauri Events (listen/emit)
┌───────────────────────────┴─────────────────────────────────────┐
│                    Rust 后端 (src-tauri/src/)                     │
│  commands/ → managers → models/ + storage.rs + git/ + skill/    │
└─────────────────────────────────────────────────────────────────┘
```

**核心数据流**：
- 前端 → 后端：`hooks` 调用 `invoke("command_name", args)` → Tauri IPC → `commands/<domain>.rs` → `managers`
- 后端 → 前端：`app.emit("event-name", payload)` → 前端 `listen()` → hooks/store 更新
- 类型契约：`src-tauri/src/models/` ↔ `src/types.ts`（serde 序列化）

---

## 两种模式

### 模式 A：三域分层（默认）

从数据模型开始，按三个域逐层向上阅读。

**适用场景**：新接手模块、架构改造后全貌理解、PRD 实现 review。

**域与层级**：

```
域 1: Rust 后端（src-tauri/src/）
├── Layer 1: 数据模型（models/）             -- 共享契约层，Rust ↔ TS 类型同步
├── Layer 2: 存储层（storage.rs）            -- JSON 持久化
├── Layer 3: Manager（terminal.rs, project.rs, agent.rs 等） -- 业务逻辑核心
├── Layer 4: 命令层（commands/）             -- Tauri IPC 入口，参数校验 + 错误转换
└── Layer 5: 应用组装（app.rs, app_state.rs） -- 依赖注入 + 命令注册

域 2: 跨端桥接
├── Layer 6: 类型契约（models/ ↔ types.ts）  -- 结构体/接口对齐
└── Layer 7: IPC 通道（invoke/events）       -- 命令名 + 事件名映射

域 3: React 前端（src/）
├── Layer 8: 类型定义（types.ts）            -- TypeScript 接口
├── Layer 9: 状态管理（store/, contexts/）    -- 全局状态 + 领域动作
├── Layer 10: 自定义 Hooks（hooks/）         -- 业务逻辑封装 + invoke 调用
└── Layer 11: UI 组件（components/）         -- 渲染 + 用户交互
```

每层只选 1-2 个代表性文件深入，不求全覆盖。用户可以随时跳过某层或深入某层。

### 模式 B：调用链追踪

从一个入口点出发，沿调用链逐函数深入。**支持跨端追踪**。

**适用场景**：排查问题、理解某个具体流程、验证数据流正确性。

**流程**：
1. 用户指定入口（如 "从 create_terminal_session 开始" 或 "从 useLocalProjects 开始"）
2. 读取入口函数，讲解输入/输出/关键分支
3. 沿主路径追踪下一个被调用的函数
4. **跨端追踪**：遇到 `invoke()` 调用时，自动跳转到对应的 Rust 命令；遇到 `listen()` 时，标注事件来源
5. 每个函数讲完后确认，用户可以要求深入某个分支或跳过

---

## 工作流

### Phase 1: 确定阅读范围

根据用户输入判断模式和范围：

| 用户输入 | 处理方式 |
|----------|----------|
| 指定目录/模块名（如 "终端管理"、"git 模块"） | 模式 A，扫描目录结构确定层级 |
| 指定文件/类型名（如 "TerminalManager"） | 先用 grep/find 推导上下游，用户选择模式 |
| 指定入口函数（如 "从 create_terminal_session 开始"） | 模式 B，沿调用链追踪 |
| 指定端（如 "看看后端"、"前端怎么实现的"） | 模式 A，聚焦单域 |
| 模糊描述（如 "过一下这块代码"） | 用 `ask_user_question` 确认范围和模式 |

**范围推导**：当用户只给了起点时：
1. 用 `find` / `grep` 找到相关文件
2. 识别文件所属的域和层级（Rust 后端 / 跨端桥接 / React 前端）
3. 按层级排序，构建阅读清单
4. 展示清单给用户确认后开始

### Phase 2: 全局视角（Zoom Out）

**在逐文件阅读之前，先建立模块全景认知。** 不知道全貌就不知道该看什么、以什么顺序看。

#### 2.1 扫描模块结构

用 `find` / `grep` / `ls` 扫描目标模块的所有相关文件，识别：
- 涉及哪些子目录 / 包
- 每个文件属于哪个域和层级
- 文件间的依赖关系（通过 import、use、mod 推导）

#### 2.2 绘制模块地图

用项目的领域词汇绘制全景地图：

**呈现格式**（以终端管理模块为例）：

```
终端管理模块全景（12 个文件）

├── src-tauri/src/models/terminal.rs          ← 数据模型层
│   └── TerminalSession, TerminalStatus       定义终端会话结构
│
├── src-tauri/src/terminal.rs                 ← Manager 层
│   └── TerminalManager                       本地 PTY 生命周期管理
│       ├── create_session()                  创建 PTY 进程
│       ├── write_to_terminal()               写入输入
│       └── close_session()                   关闭并清理
│
├── src-tauri/src/commands/terminal.rs        ← 命令层
│   └── create_terminal_session               Tauri IPC 入口
│       └── 调用 TerminalManager.create_session()
│
├── src-tauri/src/app_state.rs:25             ← 状态组装
│   └── terminal_manager: TerminalManager     注入到 AppStateWrapper
│
│   ─── 跨端桥接 ───
│
├── src/types.ts:42                           ← TypeScript 类型
│   └── TerminalSession                       与 Rust 模型对齐
│
├── src/components/terminal/TerminalView.tsx  ← UI 组件
│   └── xterm.js 渲染 + listen("terminal-output-{id}")
│
├── src/components/terminal/terminalCache.ts  ← 终端实例缓存
│   └── Map<string, Terminal>                 避免重复创建
│
└── src/hooks/useAppContainer.ts:120          ← 容器 Hook
    └── createTerminal() → invoke("create_terminal_session")

数据流：TerminalView → useAppContainer → invoke → commands/terminal → TerminalManager → PTY
事件流：PTY → TerminalManager → emit("terminal-output-{id}") → listen → TerminalView
```

**关键要求**：
- 使用领域术语（如"PTY 会话"而非"process object"、"TerminalManager"而非"service class"）
- 标注每个子模块的职责，让未读代码的人也能理解模块边界
- 标注跨端调用关系（invoke 命令名、事件名）
- 标注数据流向（哪个端发起、哪个端接收）
- 如果涉及改造，标注哪些是新增、哪些是待删除

#### 2.3 确认阅读计划

展示全景地图后，向用户确认：
- 推荐的阅读顺序（如 "建议从 models/ 开始，再看 Manager，最后看前端"）
- 用户是否想调整顺序（如 "先看前端怎么调用的"）
- 是否有特定文件想跳过或重点深入

用户确认后进入 Phase 3。

### Phase 3: 逐文件阅读

对阅读清单中的每个文件，执行以下步骤：

#### 3.1 读取文件

用 `read` 工具完整读取目标文件。如果文件超过 200 行，分段读取但保持讲解连贯。

#### 3.2 讲解要点

每个文件讲解以下内容（按需，不求全覆盖）：

**结构梳理**：
- 文件属于哪个域、什么层级、什么职责
- 核心类型/接口/函数及其作用
- 与上下游的关系（被谁调用、调用谁）

**跨端关注点**（Rust 后端文件）：
- 对应的前端调用方在哪里
- 返回类型是否与 TypeScript 类型一致
- 命令是否已在 `commands/mod.rs` 中注册
- 错误类型是否可序列化（`AppError`）

**跨端关注点**（React 前端文件）：
- 调用了哪些 Rust 命令（`invoke` 调用）
- 监听了哪些事件（`listen` 调用）
- 状态来源是 store 还是 context

**关键设计**：
- 重要的设计决策和权衡
- 接口契约和约束
- 错误处理策略

**具体引用**：
- 始终使用 `文件路径:行号` 格式引用
- 关键代码片段直接贴出（不超过 10 行）

#### 3.3 主动审查

阅读过程中主动检查以下问题：

| 检查项 | 说明 | 适用端 |
|--------|------|--------|
| Dead code | 没有调用方的函数/方法/类型 | 双端 |
| 设计偏差 | 实现与文档/PRD 描述不一致 | 双端 |
| 类型不一致 | Rust 结构体与 TypeScript 接口字段不匹配 | 跨端 |
| 命令注册遗漏 | 命令函数存在但未加入注册宏 | Rust |
| 事件名不匹配 | emit 的事件名与 listen 的事件名不一致 | 跨端 |
| 错误序列化 | AppError 变体缺少 Serialize derive 或消息丢失 | Rust |
| 边界缺失 | 缺少 nil 检查、空值处理、错误传播 | 双端 |
| 锁死锁风险 | 跨 await 持有 Mutex、嵌套锁 | Rust |
| 层级违规 | 上层依赖下层的反向依赖、跨层直接访问 | 双端 |
| 重复逻辑 | 多处存在相似代码应提取为共享函数 | 双端 |

发现问题时：
- 在讲解中自然地标注出来
- 说明问题是什么、为什么是问题
- **不修改代码**，除非用户明确要求
- 如果用户要求修复，标记为待办，继续阅读流程

#### 3.4 确认与互动

每个文件讲完后：
- 问"有什么想讨论的，还是继续看下一个？"
- 用户有疑问时优先解答
- 用户可以说"继续"、"跳过"、"深入看某个部分"
- 用户可以随时改变阅读顺序

#### 3.5 按需 Zoom Out

在逐文件阅读过程中，用户可以随时要求回到全局视角（如说 "zoom out"、"往上拉一层"、"给我个全景"），或者在以下时机自动触发：

- 过完一个域层级后，进入下一层之前
- 连续读了 3-4 个同层文件后，帮助用户重新建立整体认知
- 用户表示"有点迷失"或"这跟前面什么关系"时

**执行方式**：用最新的已读状态重新绘制 Phase 2 的模块地图（✅ 标记已读文件），问用户："要继续逐文件深入，还是先看看其他层？"

### Phase 4: 层级总结

每过完一个域层级后，做一个简要总结：
- 该层有哪些文件、各自职责
- 该层与上下游的接口契约
- 发现的问题汇总

### Phase 5: 全貌总结

所有文件过完后，输出完整总结：

```
## 代码地图

### 分层结构
[按域和层级列出所有文件及其职责]

### 数据流
[从入口到出口的完整调用链，标注文件:行号]
- 前端 → 后端：invoke("command") 链路
- 后端 → 前端：emit("event") 链路

### 类型契约
[Rust 模型与 TypeScript 接口的对应关系]

### 设计决策
[key 设计决策及其权衡]

### 发现的问题
[按严重程度排列的问题列表]
- 类型不一致: [Rust 类型:行号 ↔ TS 接口:行号]
- Dead code: [文件:行号]
- 设计偏差: [描述]
- 迁移遗漏: [描述]

### 待确认项
[阅读过程中未解决的开放问题]
```

---

## 讲解风格

- **先说结论再展开**：先用一句话概括文件作用，再展开细节
- **用表格梳理复杂关系**：多个类型/方法的对比用表格，不用长段文字
- **用流程图梳理执行顺序**：多步骤流程用缩进文本树，不用纯文字描述
- **跨端标注**：涉及跨端调用时，明确标注"前端调用方在 xxx"或"后端实现在 xxx"
- **对比新旧**：如果涉及改造，同时展示旧方案和新方案的差异
- **标注置信度**：对把握不足的部分说"这里我不确定，建议验证"
- **用领域词汇**：描述模块和调用关系时，使用项目的领域术语（如"PTY 会话"、"Skill Store"），帮助用户建立领域心智模型

---

## 关键规则

1. **先全景再深入** -- 必须先建立模块地图，再逐文件探索
2. **不改代码** -- 纯讲解 + 审查，除非用户明确说"帮我修一下"
3. **逐文件推进** -- 不批量读取，每读一个文件讲完确认后再继续
4. **有证据** -- 所有讲解引用具体 `文件路径:行号`
5. **主动审查** -- 阅读时标注 dead code、设计偏差、类型不一致、迁移遗漏
6. **用户主导** -- 用户控制节奏，可以说"继续"、"跳过"、"深入"、"换个方向"、"zoom out"
7. **不猜测** -- 代码意图不明确时说"这里我不确定"，不自行推测
8. **语言一致** -- 使用用户的语言（中文/英文）
9. **双端追踪** -- 涉及跨端调用时，主动标注另一端的位置和实现
