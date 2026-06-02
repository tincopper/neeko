---
name: code-walkthrough
description: 与用户共同阅读代码，逐层讲解架构与数据流。支持自底向上分层模式和调用链追踪模式。主动发现 dead code、设计偏差、迁移遗漏，但不修改代码。先建立全局视角再逐文件深入，阅读过程中可随时 zoom out 回到全景。Use when user wants to walkthrough code, understand architecture, trace call chains, review a module's structure, or says "过代码" / "walkthrough" / "walk me through" / "zoom out".
---

# Code Walkthrough

与用户共同阅读代码，逐文件讲解架构、数据流与设计决策。纯讲解 + 审查，不修改代码。

---

## 核心原则

1. **先全景再深入** -- 先建立模块全局地图，再逐文件探索；不知道全貌就不知道该看什么
2. **逐文件推进** -- 每次只读一个文件，讲完要点、确认用户无问题后再继续，不批量扫
3. **证据驱动** -- 所有讲解必须引用具体文件路径和行号，不凭印象说话
4. **主动审查** -- 阅读过程中主动标注 dead code、设计偏差、迁移遗漏、边界缺失，但不修改代码
5. **交互确认** -- 每个文件讲完后等用户确认，用户有疑问优先解答再继续
6. **用户主导节奏** -- 用户说"继续"才到下一个文件，用户说"看看这个"就切换焦点

---

## 两种模式

### 模式 A：自底向上分层（默认）

从数据实体开始，逐层向上经过 Repository → Service → Handler → Domain → Engine → Task。

**适用场景**：新接手模块、架构改造后全貌理解、PRD 实现 review。

**层级顺序**（按 DDD 四层架构）：

```
Layer 1: 数据实体 / 值对象（domain/entity/, domain/value_object/）
Layer 2: 仓储接口（domain/repository/）
Layer 3: 仓储实现（infrastructure/db/）
Layer 4: Application Service（application/service/）
Layer 5: Handler / API 层（handler/ 或 app/）
Layer 6: Domain 核心接口与模型（domain/ 核心类型）
Layer 7: Engine / 编排层（domain/engine/ 或 application/service/ 编排逻辑）
Layer 8: App 层适配器 / Helper（app/ 下的 adapter、helper）
Layer 9: 生产装配（bootstrap/）
Layer 10: 具体业务实现（task/、handler/ 具体实现）
```

每层只选 1-2 个代表性文件深入，不求全覆盖。用户可以随时跳过某层或深入某层。

### 模式 B：调用链追踪

从一个入口点出发，沿调用链逐函数深入。

**适用场景**：排查问题、理解某个具体流程、验证数据流正确性。

**流程**：
1. 用户指定入口（如 "从 Engine.Execute 开始" 或 "从 POST /api/v1/xxx 开始"）
2. 读取入口函数，讲解输入/输出/关键分支
3. 沿主路径追踪下一个被调用的函数
4. 每个函数讲完后确认，用户可以要求深入某个分支或跳过

---

## 工作流

### Phase 1: 确定阅读范围

根据用户输入判断模式和范围：

| 用户输入 | 处理方式 |
|----------|----------|
| 指定目录/模块名（如 "workflow 资源审计"） | 模式 A，扫描目录结构确定层级 |
| 指定文件/类型名（如 "SaveALBTask"） | 先用 grep/find 推导上下游，用户选择模式 |
| 指定入口函数（如 "从 Engine.Execute 开始"） | 模式 B，沿调用链追踪 |
| 模糊描述（如 "过一下这块代码"） | 用 `ask_user_question` 确认范围和模式 |

**范围推导**：当用户只给了起点时：
1. 用 `fffind` / `grep` 找到相关文件
2. 识别文件的 DDD 层级（entity / repository / service / handler / task）
3. 按层级排序，构建阅读清单
4. 展示清单给用户确认后开始

### Phase 2: 全局视角（Zoom Out）

**在逐文件阅读之前，先建立模块全景认知。** 不知道全貌就不知道该看什么、以什么顺序看。

#### 2.1 扫描模块结构

用 `fffind` / `grep` / `ls` 扫描目标模块的所有相关文件，识别：
- 涉及哪些子目录 / 包
- 每个文件属于哪个 DDD 层
- 文件间的依赖关系（通过 import 和调用关系推导）

#### 2.2 绘制模块地图

用项目的领域词汇（而非泛化的技术词汇）绘制全景地图：

**呈现格式**：

```
workflow 资源审计模块全景（15 个文件）

├── domain/flow/                         ← 审计声明模型（flow 包，不依赖 mife_cluster）
│   ├── resource_audit.go                ResourceChange / Declaration / Writer 接口
│   ├── resource_audit_collector.go      Collector（有变更 task 嵌入用）
│   ├── no_resource_change_audit.go      NoResourceChangeAudit（无变更 task 嵌入用）
│   └── flow_task.go                     FlowTask 接口 + DeclareResourceAudit
│
├── domain/engine/                       ← Engine 审计处理
│   ├── engine.go                        Engine 结构体 + writer 注入
│   └── task_executor.go                 processResourceAudit 核心逻辑
│
├── app/workflow/audit/                  ← App 层适配器
│   ├── writer.go                        ResourceAuditWriter（flow → entity 转换）
│   └── resource_change.go              AlbCreated / NodeCreated 等 helper
│
├── domain/resource_audit/               ← 持久化层
│   ├── entity/change_record.go          ResourceChangeRecord 实体
│   ├── repository/audit_repository.go   AuditRepository 接口
│   └── infrastructure/db/               GORM 实现
│
└── bootstrap/                           ← 生产装配
    └── register_admin_workflows.go      deps 注册 + writer 注入

数据流方向：task → collector → Engine → writer → service → repository → DB
```

**关键要求**：
- 使用领域术语（如"资源审计声明"而非"audit struct"、"Collector"而非"helper class"）
- 标注每个子模块的职责，让未读代码的人也能理解模块边界
- 标注模块间的调用关系和数据流方向
- 如果涉及改造，标注哪些是新增、哪些是待删除

#### 2.3 确认阅读计划

展示全景地图后，向用户确认：
- 推荐的阅读顺序（如 "建议从底层数据模型开始，逐层向上"）
- 用户是否想调整顺序（如 "先看 Engine 还是先看 entity"）
- 是否有特定文件想跳过或重点深入

用户确认后进入 Phase 3。

### Phase 3: 逐文件阅读

对阅读清单中的每个文件，执行以下步骤：

#### 3.1 读取文件

用 `read` 工具完整读取目标文件。如果文件超过 200 行，分段读取但保持讲解连贯。

#### 3.2 讲解要点

每个文件讲解以下内容（按需，不求全覆盖）：

**结构梳理**：
- 文件属于哪个 DDD 层、什么职责
- 核心类型/接口/函数及其作用
- 与上下游的关系（被谁调用、调用谁）

**关键设计**：
- 重要的设计决策和权衡
- 接口契约和约束
- 错误处理策略

**具体引用**：
- 始终使用 `文件路径:行号` 格式引用
- 关键代码片段直接贴出（不超过 10 行）

#### 3.3 主动审查

阅读过程中主动检查以下问题：

| 检查项 | 说明 |
|--------|------|
| Dead code | 没有调用方的函数/方法/类型 |
| 设计偏差 | 实现与文档/PRD 描述不一致 |
| 迁移遗漏 | 接口变更后未同步更新的实现 |
| 边界缺失 | 缺少 nil 检查、空值处理、错误传播 |
| 层级违规 | 上层依赖下层的反向依赖、跨层直接访问 |
| 重复逻辑 | 多处存在相似代码应提取为共享函数 |

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

- 过完一个 DDD 层级后，进入下一层之前
- 连续读了 3-4 个同层文件后，帮助用户重新建立整体认知
- 用户表示"有点迷失"或"这跟前面什么关系"时

**执行方式**：用最新的已读状态重新绘制 Phase 2 的模块地图（✅ 标记已读文件），问用户："要继续逐文件深入，还是先看看其他层？"

### Phase 4: 层级总结

每过完一个 DDD 层级后，做一个简要总结：
- 该层有哪些文件、各自职责
- 该层与上下游的接口契约
- 发现的问题汇总

### Phase 5: 全貌总结

所有文件过完后，输出完整总结：

```
## 代码地图

### 分层结构
[按层级列出所有文件及其职责]

### 数据流
[从入口到出口的完整调用链，标注文件:行号]

### 设计决策
[关键决策及其权衡]

### 发现的问题
[按严重程度排列的问题列表]
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
- **对比新旧**：如果涉及改造，同时展示旧方案和新方案的差异
- **标注置信度**：对把握不足的部分说"这里我不确定，建议验证"
- **用领域词汇**：描述模块和调用关系时，使用项目的领域术语（如"资源审计声明"而非"audit object"），帮助用户建立领域心智模型

---

## 关键规则

1. **先全景再深入** -- 必须先建立模块地图，再逐文件探索
2. **不改代码** -- 纯讲解 + 审查，除非用户明确说"帮我修一下"
3. **逐文件推进** -- 不批量读取，每读一个文件讲完确认后再继续
4. **有证据** -- 所有讲解引用具体 `文件路径:行号`
5. **主动审查** -- 阅读时标注 dead code、设计偏差、迁移遗漏
6. **用户主导** -- 用户控制节奏，可以说"继续"、"跳过"、"深入"、"换个方向"、"zoom out"
7. **不猜测** -- 代码意图不明确时说"这里我不确定"，不自行推测
8. **语言一致** -- 使用用户的语言（中文/英文）
