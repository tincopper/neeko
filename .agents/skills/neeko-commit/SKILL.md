---
name: neeko-commit
description: 自动分析当前 Git 工作树的未提交更改，并严格按照 Conventional Commits 规范生成、格式化或执行代码提交。
triggers:
  - keywords: ["commit", "git commit", "提交代码", "生成提交信息"]
  - commands: ["neeko-commit", "/commit", "/git-commit"]
  - file_changes: true
  - disable-model-invocation: true
version: 1.0.0
---

# Skill: GitHub 代码提交规范专家

你是一个严谨的 AI 软件工程师。你的职责是分析用户的代码改动，并严格按照 **Conventional Commits 1.0.0** 规范以及 GitHub 协作最佳实践，生成或执行规范的 Git 提交。

## 核心任务流程

1. **提取变更**：读取当前工作区与暂存区的代码差异（`git diff` 或 `git diff --cached`）。
2. **分析意图**：判断变更属于功能开发、Bug 修复、重构还是文档更新。
3. **生成 Message**：严格按照下方规范格式化提交信息。
4. **用户确认**：展示生成的 Message，并在用户确认后（或根据当前 Agent 权限）安全地执行 `git commit`。

---

## 提交信息格式规范

生成的 commit message 必须包含**页眉（Header）**，可选**正文（Body）**和**页脚（Footer）**。

```text
<type>(<scope>): <subject>

<body>

<footer>
```

### 1. 类型（Type）限制
必须且只能使用以下严格定义的类型：

| 类型 (Type) | 适用场景 | 示例 |
| :--- | :--- | :--- |
| **feat** | 引入新功能 / 新特性 | `feat(auth): 增加微信扫码登录功能` |
| **fix** | 修复 Bug / 缺陷 | `fix(cart): 修复商品数量减少时未刷新价格的问题` |
| **docs** | 仅修改文档、注释或 README | `docs(readme): 补充开发环境配置步骤` |
| **style** | 纯格式调整（不影响代码运行逻辑，如空格、分号、格式化） | `style(user): 格式化用户服务文件` |
| **refactor** | 代码重构（既不修复 Bug 也不添加新功能） | `refactor(db): 优化数据库连接池初始化逻辑` |
| **perf** | 提升性能或运行效率的改动 | `perf(image): 引入懒加载减少首页白屏时间` |
| **test** | 添加或修改测试用例 | `test(order): 增加订单支付成功路径的单元测试` |
| **chore** | 构建流程、依赖管理、辅助工具变动（如更新 npm 包、修改 CI 脚本） | `chore(deps): 升级 spring-boot 至最新稳定版` |

### 2. 影响范围（Scope）
* 必须使用半角小括号 `()` 包裹。
* 明确指出改动涉及的模块、组件或文件名（如：`auth`, `api`, `views/login`）。
* 如果是全局或多处变动，可以省略。

### 3. 主题（Subject）
* **简短扼要**：控制在 50 个字符以内。
* **动词开头**：使用祈使句（如 `增加...`, `修复...`, `重构...`），不要随手写 `fix bug`。
* **结尾无标点**：末尾不要加句号。

### 4. 正文与页脚（Body & Footer）- 条件触发
* **长描述（Body）**：当改动较为复杂时自动启用，阐述“为什么要改”和“怎么改的”，行宽限制为 72 字符。
* **重大变更（Breaking Change）**：任何包含不兼容 API 变更的提交，必须在 Header 处的 type 后加 `!`，且在 Footer 以 `BREAKING CHANGE: <描述>` 开头。
* **关联 Issue**：如果有关联的 GitHub Issue，必须在 Footer 闭合（如：`Closes #123` 或 `Fixes #456`）。

---

## AI 执行准则与对比示例

### 🚫 错误的行为示范
* **严禁**：一次性把涉及多个不相干功能的修改打包成一个 `feat: 搞定了一些需求` 的提交。
* **严禁**：在 subject 里堆砌废话，如 `feat: 我今天写了这个文件的代码以支持功能`。

###  正确的行为示范
* **原子化提交**：若发现用户代码同时包含了一个新功能和两个无关的 Bug 修复，应提示用户：“检测到多项不同性质的修改，建议拆分为 3 次独立提交”，并依次为用户生成。

### 💡 规范生成示例

**场景 A：修复了支付页面的一个空指针异常，并关联了 Issue #22**
```text
fix(payment): 修复微信支付回调时的空指针异常

当微信回调数据中缺少 openid 字段时会引发 NullPointerException，
本次修改增加了非空校验以及异常日志捕获。

Closes #22
```

**场景 B：修改了用户 API 的返回结构，属于不兼容的破坏性更新**
```text
refactor(api)!: 重构用户详情接口的返回字段

BREAKING CHANGE: 统一将返回结构中的 `user_name` 变更为 `username`，
旧版前端需要同步更新字段映射。
```

---

## 交互输出格式

当你被触发执行此 Skill 时，请直接输出以下格式供用户确认：

```text
### 🔍 变更分析报告
* **检测到的类型**：[例如：fix]
* **影响的范围**：[例如：auth]
* **变更核心摘要**：[简短描述]

### 📝 推荐的 Commit Message
\`\`\`text
[在此处输出生成的标准 Commit Message]
\`\`\`

是否直接执行此提交？(Y/N)
```