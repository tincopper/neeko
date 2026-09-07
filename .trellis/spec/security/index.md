# 安全开发指南

> Tauri v2 桌面应用的安全配置与最佳实践。

---

## 概述

本项目基于 **Tauri v2**，使用 capability 系统进行权限管理。安全配置位于 `src-tauri/capabilities/default.json` 和 `tauri.conf.json` 中。

---

## 指南索引

| 指南 | 说明 | 状态 |
|------|------|------|
| [权限配置](./allowlist.md) | Tauri v2 capability 配置、fs/shell/window 权限 | 已填写 |

---

## 核心安全原则

1. **最小权限**：仅启用应用必需的功能
2. **范围限制**：对 fs/shell 等权限设置明确的 scope
3. **输入校验**：命令参数需校验类型、范围、业务规则
4. **路径规范化**：必要时对路径参数 `canonicalize` 并限制在允许目录内

## 文件树路径安全细则

- Local 路径：优先 `canonicalize()` 后用 `starts_with(root)` 校验，能覆盖符号链接和 `..` 穿越。
- WSL / Remote 相对子路径：本端无法可靠 canonicalize，必须在拼接 `root_path` 前做严格语法校验；仅接受普通相对段，拒绝绝对路径、空段、`.`、`..`、反斜杠和 NUL。
- Shell 转义不能替代路径边界校验：`safe_path()` 只防止命令注入，不防止越出项目根。
- WSL / Remote 文件树的 ignored 标记与剪枝功能建立在越界校验之后，安全校验不应改变合法相对路径的懒加载行为。
- 远程 ignored 查询结果必须有界：解析输出设上限并告警，缓存 key 只含 project / target / root 等稳定非敏感信息，且必须提供 TTL 与 `.gitignore` / exclude / unwatch 失效。

---

## 如何使用这些指南

对于每个指南文件：

1. 记录项目**实际使用的约定**
2. 包含来自代码库的**代码示例**
3. 列出**禁止模式**及原因
4. 添加团队踩过的**常见坑**

---

**语言**：所有文档以**中文**编写。