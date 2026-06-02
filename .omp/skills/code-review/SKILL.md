---
name: code-review
description: 深度代码评审,基于项目规范检查代码质量、架构健康和可维护性。适用于 PR review、文件/目录评审、模块级架构审视。纯评审不改代码。Use when user wants code review, PR review, architecture review, or asks to review code quality.
---

# Code Review

深度代码评审,基于项目特定规范(`.trellis/spec/`)进行分析。纯评审,不修改代码。

---

## 核心原则

1. **证据驱动** - 所有问题必须引用具体文件、行号、代码片段,不凭印象说话
2. **规范为本** - 评审标准来自 `.trellis/spec/` 中的项目规范,不是个人偏好
3. **纯评审** - 只报告问题和建议,不修改代码,除非用户明确要求
4. **交互确认** - 评审范围不明确时,用 `ask_user_question` 确认后再开始
5. **聚焦深度** - 宁可深入分析少量文件,也不浅尝辄止扫全部

---

## 工作流

### Phase 1: 确定评审范围(交互式)

根据用户输入判断评审类型,选择不同流程:

| 用户输入 | 评审类型 | 处理方式 |
|----------|----------|----------|
| 文件/目录路径 | 文件评审 | 直接读取文件 |
| `git diff` / 当前变更 | 变更评审 | 执行 `git diff` 获取变更 |
| 分支名 / PR 对比 | PR 评审 | `git diff branch1..branch2` |
| 模块名称(如"认证模块") | 模块评审 | 搜索相关文件后评审 |

**如果用户没有指定范围**:用 `ask_user_question` 询问。

**示例问题**:
- "你想要评审什么?当前变更 / 指定文件 / 指定模块 / 分支对比?"
- "我发现了这些变更文件:[列表]。要全部评审还是聚焦某个模块?"

#### GitLab CLI 集成检测(PR 评审时)

当判定为 **PR 评审** 时,执行以下检测流程:

1. **检测 glab 可用性**(双重检测,任一失败则静默回退到纯对话模式)
   ```bash
   # 步骤 1:检查安装
   which glab
   # 步骤 2:检查认证状态
   glab auth status
   ```
   - 若未安装或未认证:跳过 GitLab 集成,进入常规 PR 评审流程(不提示用户)

2. **拉取开放 MR 列表**
   ```bash
   glab mr list --state opened
   ```
   - 展示 MR 列表,让用户选择目标 MR
   - 若用户已显式提供了 MR 编号,直接使用

3. **检查当前分支**
   - 获取 MR 的源分支,对比当前分支
   - 若不匹配:用 `ask_user_question` 询问是否切换到 MR 源分支
   - 若用户选择不切换:使用 `git diff <source>...<target>` 获取变更内容

4. **询问发布意愿**
   - 用 `ask_user_question` 询问:"是否将评审结果发布到 GitLab MR?"
   - 选"是":评审完成后进入 Phase 5
   - 选"否":跳过 Phase 5,纯对话输出

### Phase 2: 理解上下文

1. **读取变更/目标文件**
   - 文件评审:直接读取指定文件
   - 变更评审:`git diff HEAD` 获取变更,读取变更文件完整内容
   - PR 评审:`git diff main..feature-branch` 获取变更
   - 模块评审:用搜索工具定位模块文件

2. **识别文件类型**
   - 前端文件:`.ts`、`.tsx`、`.vue`、`.js`、`.jsx` 等在 `frontend/` 目录下
   - 后端文件:`.go` 在 `backend/` 目录下
   - 根据文件类型加载对应规范(见"规范加载")

3. **读取相关规范**
   - 前端文件 → 读取 `.trellis/spec/frontend/` 相关规范
   - 后端文件 → 读取 `.trellis/spec/backend/` 相关规范
   - 所有文件 → 读取 `.trellis/spec/guides/` 通用指南

4. **理解业务意图**
   - 阅读代码注释、函数命名、上下文调用链
   - 理解这段代码要解决什么问题
   - 如果意图不明确,标注为"意图不明"而非猜测

### Phase 3: 深度评审

按以下维度逐项检查,每个发现必须附带证据。

#### 3.1 编码规范(coding-guidelines)

检查项:
- [ ] 命名是否准确、专业、无歧义
- [ ] 布尔值是否使用 `is/has/can/should` 前缀
- [ ] 是否通过提早返回减少嵌套
- [ ] 超长表达式是否拆分为解释变量
- [ ] 泛型名字(`tmp`、`retval`、`data`)是否替换为具体名字
- [ ] 是否附带单位信息(如 `elapsedMs`)

#### 3.2 质量规范(quality-guidelines)

**前端**:
- [ ] Vue 组件使用 `<script setup lang="ts">`
- [ ] 样式使用 `<style scoped>`
- [ ] 没有手动导入自动导入的 API(`ref`、`computed`、`useRouter` 等)
- [ ] 没有 `any` 类型
- [ ] API 调用使用泛型类型参数
- [ ] 新路由使用懒加载
- [ ] 测试 mock 了所有网络调用
- [ ] 状态枚举变更是否同步了所有映射点

**后端**:
- [ ] 新接口有 `interface.go` + 编译期检查
- [ ] 基础设施层错误带上下文包装(`fmt.Errorf("描述: %w", err)`)
- [ ] Handler 层没有业务逻辑
- [ ] Context 在各层正确传递
- [ ] 日志中没有密钥或个人信息
- [ ] 修改接口后运行了 `make mock`
- [ ] 依赖方向正确:`handler -> application -> domain <- infrastructure`
- [ ] 没有使用 `init()` 函数
- [ ] 只有 bootstrap 中使用 `panic`

#### 3.3 错误处理(error-handling / guides)

- [ ] 错误是否被正确处理(没有 `_ = err`)
- [ ] 错误信息是否包含足够上下文
- [ ] 资源释放是否在 defer 中处理
- [ ] 边界条件是否覆盖(空值、零值、越界)

#### 3.4 代码复用(code-reuse-thinking-guide)

- [ ] 是否搜索过已有相似代码再写新代码
- [ ] 是否存在复制粘贴的逻辑应提取为共享函数
- [ ] 常量是否单一数据源
- [ ] 相似模式是否遵循相同结构

#### 3.5 跨层数据流(cross-layer-thinking-guide)

- [ ] 层边界处数据格式是否明确
- [ ] 验证是否在入口点统一进行
- [ ] 是否存在泄漏的抽象(组件知道数据库模式)
- [ ] 前后端对同一字段的理解是否一致(如 `region_id=0` 的 falsy 问题)

#### 3.6 架构与可维护性

- [ ] 函数/方法长度是否合理(超过 50 行需要关注)
- [ ] 圈复杂度是否过高(嵌套超过 3 层需要关注)
- [ ] 模块职责是否单一
- [ ] 依赖关系是否清晰(没有循环依赖)
- [ ] 是否存在技术债务(TODO/FIXME/HACK 注释)
- [ ] 是否有足够的测试覆盖

### Phase 4: 输出结果

#### 直接回复模式(默认)

按以下格式在对话中输出:

```
## 评审结果

### 问题列表

**[严重程度] 问题标题**
- 文件:`path/to/file.ts:42`
- 规范:违反 `coding-guidelines.md` - "提早返回减少嵌套"
- 问题:[具体描述]
- 证据:[代码片段]
- 建议:[如何修复]

---

### 总结

- 严重:X 个
- 建议:X 个
- 观察:X 个
```

**严重程度分级**:
- **严重(Blocker)** - 必须修复,影响正确性或安全性
- **建议(Suggestion)** - 应该修复,影响可维护性或可读性
- **观察(Note)** - 可以改进,不影响功能

#### 报告模式(用户要求时)

用 `ask_user_question` 询问用户报告的存储路径和文件名。

报告内容包含完整的评审结果、规范引用、修复建议。

---

## 规范加载

根据文件类型自动选择规范:

```
前端文件 (.ts/.tsx/.vue/.js/.jsx)
  → .trellis/spec/frontend/coding-guidelines.md
  → .trellis/spec/frontend/quality-guidelines.md
  → .trellis/spec/frontend/component-guidelines.md(组件文件)
  → .trellis/spec/frontend/hook-guidelines.md(composable 文件)
  → .trellis/spec/frontend/state-management.md(store 文件)
  → .trellis/spec/frontend/type-safety.md(所有 TypeScript 文件)
  → .trellis/spec/guides/cross-layer-thinking-guide.md
  → .trellis/spec/guides/code-reuse-thinking-guide.md

后端文件 (.go)
  → .trellis/spec/backend/coding-guidelines.md
  → .trellis/spec/backend/quality-guidelines.md
  → .trellis/spec/backend/error-handling.md
  → .trellis/spec/backend/logging-guidelines.md
  → .trellis/spec/backend/auth-guidelines.md(认证相关)
  → .trellis/spec/backend/database-guidelines.md(数据库相关)
  → .trellis/spec/backend/workflow-guidelines.md(workflow 相关)
  → .trellis/spec/guides/cross-layer-thinking-guide.md
  → .trellis/spec/guides/code-reuse-thinking-guide.md
```

**不要一次性读取所有规范**。先读 index.md 了解结构,再按需读取具体规范。

---

## 关键规则

1. **不改代码** — 纯评审，不修改源代码，除非用户明确要求
2. **先读再评** — 评审前必须先完整阅读目标文件和相关规范
3. **有证据** — 每个问题必须引用具体的文件、行号、代码片段
4. **不猜测** — 代码意图不明确时，标注“意图不明”，不自行推测
5. **聚焦深度** — 宁可深入分析 5 个文件，也不浅扫 50 个文件
6. **规范优先** — 评审依据是 `.trellis/spec/` 中的规范，不是通用最佳实践
7. **语言一致** — 评审报告使用用户的语言（中文/英文）
8. **交互确认** — 范围不明确时用 `ask_user_question` 确认

---

## Phase 5: 发布到 GitLab（可选）

> 仅当 Phase 1 中用户选择“发布到 GitLab MR”时执行此阶段。

### 5.1 用户确认发布内容

在对话中以编号列表展示所有评审发现，让用户选择要发布的条目：

```
以下是评审发现，请选择要发布到 GitLab MR 的条目：

1. [Blocker] handler 层包含业务逻辑 - service/user.go:42
2. [Suggestion] 嵌套过深，建议提早返回 - controller/auth.go:78
3. [Note] TODO 注释未清理 - utils/helper.go:15
...

请输入要发布的编号（如 "1,2,5" 或 "全部"）：
```

### 5.2 发布行内 Discussion

对用户选择的每条发现，使用 `glab mr note create` 发布行内评论：

```bash
# 行号在 diff 范围内 — 发布行级评论
glab mr note create <MR_ID> \
  --file "path/to/file.go" \
  --line <LINE_NUMBER> \
  --unique \
  -m "**[Severity]** 问题描述

> 规范：`spec-file.md` - \"规则名称\"

建议：具体修复方案"

# 行号不在 diff 范围内 — 降级为文件级评论
glab mr note create <MR_ID> \
  --file "path/to/file.go" \
  --unique \
  -m "**[Severity]** 问题描述 (Line <LINE_NUMBER>)

> 规范：`spec-file.md` - \"规则名称\"

建议：具体修复方案"
```

**评论格式**：
- 第一行：`**[严重度]**` + 问题描述
- 引用块：违反的规范文件和规则名称
- 最后：具体修复建议

### 5.3 发布汇总 Note

所有行内评论发送完毕后，发布一条汇总 Note：

```bash
glab mr note create <MR_ID> --unique -m "汇总内容"
```

汇总 Note 内容格式：

```markdown
## Code Review 汇总

| 严重度 | 数量 |
|---------|------|
| Blocker | X |
| Suggestion | X |
| Note | X |

详细问题已在对应文件行上发起 Discussion，请查看 Changes 页面。
```

### 5.4 错误处理

- 逐条发送，失败的跳过继续发送其他项
- 所有条目发送完毕后，汇报结果：

```
发布完成：
- 成功：X 条
- 失败：X 条
- 失败原因：[列出每条失败的文件和错误信息]
```

### 5.5 去重策略

- 所有 `glab mr note create` 命令均使用 `--unique` 标志
- 避免对同一 MR 多次评审时产生重复评论
