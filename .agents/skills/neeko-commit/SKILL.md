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
| **feat** | 引入新功能 / 新特性 | `feat(auth): add WeChat QR-code sign-in` |
| **fix** | 修复 Bug / 缺陷 | `fix(cart): refresh the price when quantity drops` |
| **docs** | 仅修改文档、注释或 README | `docs(readme): add dev environment setup steps` |
| **style** | 纯格式调整（不影响代码运行逻辑，如空格、分号、格式化） | `style(user): format the user service module` |
| **refactor** | 代码重构（既不修复 Bug 也不添加新功能） | `refactor(db): simplify pool initialization` |
| **perf** | 提升性能或运行效率的改动 | `perf(image): lazy-load offscreen thumbnails` |
| **test** | 添加或修改测试用例 | `test(order): cover the paid checkout path` |
| **chore** | 构建流程、依赖管理、辅助工具变动（如更新 npm 包、修改 CI 脚本） | `chore(deps): bump spring-boot to the latest stable` |

**语言（硬规则）**：subject / body / footer **一律英文**。本仓库历史上有大量中文提交
（如 `fix(git): 归属判定改手写分量比较`），它们不符合现行约定；中文只允许出现在被引用的
代码标识符、文件路径与 spec 文档名里。commitlint 不校验这条，由 `CONTRIBUTING.md`
「Commit Message Guidelines → Rules」定义、评审把关。

### 2. 影响范围（Scope）
* 必须使用半角小括号 `()` 包裹。
* 明确指出改动涉及的模块、组件或文件名（如：`auth`, `api`, `views/login`）。
* 如果是全局或多处变动，可以省略。

### 3. 主题（Subject）
* **简短扼要**：控制在 50 个字符以内（本仓库实际多在 50-70，commitlint 上限 100）。
* **动词开头**：使用祈使句（如 `add ...`, `fix ...`, `refactor ...`），不要随手写 `fix bug`。
* **结尾无标点**：末尾不要加句号。

### 4. 正文与页脚（Body & Footer）- 条件触发
* **长描述（Body）**：当改动较为复杂时自动启用，阐述“为什么要改”和“怎么改的”，行宽限制为 72 字符。
* **重大变更（Breaking Change）**：任何包含不兼容 API 变更的提交，必须在 Header 处的 type 后加 `!`，且在 Footer 以 `BREAKING CHANGE: <描述>` 开头。
* **关联 Issue**：如果有关联的 GitHub Issue，必须在 Footer 闭合（如：`Closes #123` 或 `Fixes #456`）。

---

## AI 执行准则与对比示例

### 🚫 错误的行为示范
* **严禁**：一次性把涉及多个不相干功能的修改打包成一个 `feat: wrap up a few things` 的提交。
* **严禁**：在 subject 里堆砌废话，如 `feat: I wrote the code of this file today`。
* **严禁**：用中文写提交信息（`fix(git): 归属判定改手写分量比较` —— 历史遗留形态，不要再新增）。

###  正确的行为示范
* **原子化提交**：若发现用户代码同时包含了一个新功能和两个无关的 Bug 修复，应提示用户：“检测到多项不同性质的修改，建议拆分为 3 次独立提交”，并依次为用户生成。

### 💡 规范生成示例

**场景 A：修复了支付页面的一个空指针异常，并关联了 Issue #22**
```text
fix(payment): guard the callback against a missing openid

A WeChat callback without the openid field raised a NullPointerException.
Validate the payload and log the rejection before dereferencing it.

Closes #22
```

**场景 B：修改了用户 API 的返回结构，属于不兼容的破坏性更新**
```text
refactor(api)!: reshape the user detail response

BREAKING CHANGE: `user_name` becomes `username` in the response body; the
frontend has to map the new field.
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