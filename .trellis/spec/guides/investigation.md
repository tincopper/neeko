# 调研与验证

> 浏览器自动化在开发中的使用场景与操作流程。

---

## 概述

在**调研**和**验证**阶段使用浏览器自动化工具可显著提升效率：
- 调研阶段：克隆/仿站时，了解目标网站的 DOM 结构、可交互元素
- 验证阶段：开发完成后，验证本地前端的功能是否符合预期

> **注意**：本项目为桌面应用而非 Web 应用，调研场景主要适用于设计参考网站（如 VS Code 扩展市场等 Web 页面）。

---

## 核心流程

### 通用流程

1. **打开页面**：`agent-browser --cdp 9222 open <url>`
2. **获取可交互元素**：`agent-browser --cdp 9222 snapshot -i` → 得到 `@e1`、`@e2` 等引用
3. **操作**：用 refs 执行 `click`、`fill`、`select`、`check` 等
4. **页面变化后**：再次 `snapshot -i` 获取新 refs，再继续操作或断言

### 常用命令速查

| 用途 | 命令 |
|------|------|
| 打开页面 | `agent-browser --cdp 9222 open <url>` |
| 可交互元素 | `agent-browser --cdp 9222 snapshot -i` |
| 点击 | `agent-browser --cdp 9222 click @e1` |
| 填写 | `agent-browser --cdp 9222 fill @e2 "内容"` |
| 等待加载 | `agent-browser --cdp 9222 wait --load networkidle` |
| 等待毫秒 | `agent-browser --cdp 9222 wait 2000` |
| 取文案 | `agent-browser --cdp 9222 get text @e1` |
| 页面文本 | `agent-browser --cdp 9222 get text body > out.txt` |
| 截图 | `agent-browser --cdp 9222 screenshot` |

---

## 场景一：调研目标网站

### 目标

了解要参考的网站的 DOM 结构、可交互元素、文案与交互路径。

### 流程

```bash
# 1. 打开目标页面
agent-browser --cdp 9222 open https://目标网站.com/页面

# 2. 获取可交互元素
agent-browser --cdp 9222 snapshot -i
# 输出如：
# @e1 [button] "登录"
# @e2 [input] "用户名"
# @e3 [a] "文档"

# 3. 获取特定元素文案
agent-browser --cdp 9222 get text @e1
agent-browser --cdp 9222 get text body > page.txt  # 保存整个页面文本

# 4. 可选：截图留档
agent-browser --cdp 9222 screenshot
```

### 输出信息用于

- 组件划分设计
- 数据结构定义
- IPC 命令设计
- 交互流程规划

---

## 场景二：验证本地开发效果

### 目标

开发完成后，在浏览器中打开本地前端，确认元素存在、可点击、表单可填写、流程可走通。

### 前提

先启动本地开发服务器：

```bash
# 在另一个终端
pnpm tauri dev
# Tauri dev 地址：http://localhost:1420
```

### 流程

```bash
# 1. 打开本地前端
agent-browser --cdp 9222 open http://localhost:1420

# 2. 获取初始元素
agent-browser --cdp 9222 snapshot -i

# 3. 按设计逐项验证
# 例如：点击侧栏 → 打开列表 → 新建任务 → 填写表单 → 提交

agent-browser --cdp 9222 click @e1                    # 点击项目
agent-browser --cdp 9222 wait --load networkidle       # 等待加载
agent-browser --cdp 9222 snapshot -i                   # 重新获取元素
agent-browser --cdp 9222 click @e5                     # 点击添加按钮
agent-browser --cdp 9222 fill @e6 "测试任务"           # 填写任务名
agent-browser --cdp 9222 click @e7                     # 点击提交

# 4. 可选：截图或保存页面文本做回归
agent-browser --cdp 9222 screenshot
```

---

## 常见问题

### 1. Ref 失效

> **问题**：页面跳转或 DOM 更新后，之前的 ref 无法使用。

**解决**：每次页面变化后重新执行 `snapshot -i`。

### 2. 元素未加载完成

> **问题**：操作时元素尚未加载完成。

**解决**：使用 `wait` 命令等待：
- `wait --load networkidle` —— 等待网络请求完成
- `wait 2000` —— 等待固定时间

### 3. 元素定位困难

> **问题**：页面结构复杂，元素难以定位。

**解决**：
- 使用 `snapshot -i` 获取所有可交互元素
- 结合 `get text` 获取元素文案辅助定位
- 尝试不同的交互路径

---

## 相关文档

- [agent-browser SKILL 完整文档](file:///Users/akm/Documents/agent-browser/skills/agent-browser/SKILL.md)（完整命令、语义定位符、多会话等）
- [跨层思维指南](./cross-layer-thinking-guide.md)
- [代码复用思维指南](./code-reuse-thinking-guide.md)