# 前端开发指南

> 本项目的前端开发最佳实践。

---

## 概述

本目录包含前端开发的各项指南。每个文件都记录了项目的实际约定。

---

| 指南 | 说明 | 状态 |
|------|------|------|
| [目录结构](./directory-structure.md) | 模块组织与文件布局 | 已填写 |
| [组件指南](./component-guidelines.md) | 组件模式、Props、组合方式 | 已填写 |
| [设计令牌](./design-tokens.md) | 样式唯一权威源：token 分层与清单、三个必知的坑（别名断链 / @theme 自引用 / color-mix）、字体与密度与 z-index 阶梯、禁止写法 | 已填写 |
| [Hook 指南](./hook-guidelines.md) | 自定义 Hooks、数据获取模式、文件树单一寻址面 | 已填写 |
| [状态管理](./state-management.md) | 本地状态、全局状态、服务端状态；含「展开态与缓存同槽」「确保态 vs 翻转态」两类判定准则 | 已填写 |
| [质量指南](./quality-guidelines.md) | 代码规范、禁止模式 | 已填写 |
| [类型安全](./type-safety.md) | 类型模式、校验 | 已填写 |
| [API 层](./api-layer.md) | Tauri IPC 调用、事件监听、适配器模式 | 已填写 |
| [交互模式](./interaction-patterns.md) | 拖拽排序、手势、Pointer Events 模式；**拖拽投递的插入端口模型**（渲染方注册 + ①→⑦ 仲裁 + 禁止标签名启发式） | 已填写 |
| [Git Graph](./git-graph.md) | Commit history DAG 渲染规范、布局算法、不变量 | 已填写 |
| [StatusBar](./status-bar.md) | 状态栏 registry 机制、item 契约、互斥与 bridge 规范 | 已填写 |
| [导航目标模型](./navigation-goal.md) | 用户意图跳转的 goal 状态、兑现器契约、三条不变量与生命周期 | 已填写 |
| [注释翻译](./comment-translation.md) | 代码编辑器内注释/docstring 翻译：三层抽象、代码不翻铁律、内容寻址、StateField 投影、实测踩坑表 | 已填写 |

---

## 如何使用这些指南

对于每个指南文件：

1. 记录项目**实际使用的约定**（而非理想状态）
2. 包含来自代码库的**代码示例**
3. 列出**禁止模式**及原因
4. 添加团队踩过的**常见坑**

目标是帮助 AI 助手和新团队成员理解本项目的运作方式。

---

**语言**：所有文档以**中文**编写。

---

## 相关主题

| 主题 | 说明 |
|------|------|
| [安全配置](../security/index.md) | Tauri v2 权限配置 |
| [后端开发](../backend/index.md) | Rust/Tauri 后端指南 |
