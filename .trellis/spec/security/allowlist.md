# 权限配置

> Tauri v2 capability 系统与安全配置。

---

## 概述

Tauri v2 使用 **capability** 系统进行权限管理。权限配置位于：
- `src-tauri/capabilities/default.json` —— 窗口权限定义
- `tauri.conf.json` —— 应用级安全配置

---

## Capability 系统

### 核心概念

| 概念 | 说明 |
|------|------|
| Capability | 权限集合，关联到特定窗口 |
| Permission | 单一功能权限（如 `core:window:allow-minimize`） |
| Scope | 权限的可作用范围（如 fs 的允许目录列表） |

### 权限结构

```json
{
  "identifier": "default",
  "description": "Default capabilities for Neeko",
  "windows": ["main"],
  "permissions": [
    "core:default",           // 核心默认权限
    "core:event:default",     // 事件默认权限
    "core:window:allow-minimize",
    "dialog:allow-open"
  ]
}
```

---

## 当前项目配置

### 已启用的权限

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "core:event:default",
    "core:event:allow-listen",
    "core:event:allow-emit",
    "core:window:allow-start-dragging",
    "core:window:allow-set-focus",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-unmaximize",
    "core:window:allow-close",
    "core:window:allow-is-maximized",
    "dialog:allow-open"
  ]
}
```

### 应用级安全配置

```json
// tauri.conf.json
{
  "app": {
    "withGlobalTauri": true,
    "security": {
      "csp": null    // 禁用 Content Security Policy（开发方便）
    }
  }
}
```

---

## 常用权限参考

### 窗口操作

| 权限 | 用途 |
|------|------|
| `core:window:allow-minimize` | 最小化窗口 |
| `core:window:allow-maximize` | 最大化窗口 |
| `core:window:allow-unmaximize` | 取消最大化 |
| `core:window:allow-close` | 关闭窗口 |
| `core:window:allow-start-dragging` | 拖拽移动窗口 |
| `core:window:allow-set-focus` | 聚焦窗口 |
| `core:window:allow-is-maximized` | 查询最大化状态 |

### 事件系统

| 权限 | 用途 |
|------|------|
| `core:event:default` | 默认事件权限 |
| `core:event:allow-listen` | 监听事件 |
| `core:event:allow-emit` | 发送事件 |

### 文件系统（需额外配置 scope）

| 权限 | 用途 |
|------|------|
| `fs:default` | 默认 fs 权限 |
| `fs:allow-read` | 读取文件 |
| `fs:allow-write` | 写入文件 |
| `fs:allow-exists` | 检查文件存在 |
| `fs:scope` | 配置允许访问的目录 |

### Shell 命令

| 权限 | 用途 |
|------|------|
| `shell:default` | 默认 shell 权限 |
| `shell:allow-open` | 打开 URL/文件 |
| `shell:allow-execute` | 执行命令 |

### 对话框

| 权限 | 用途 |
|------|------|
| `dialog:allow-open` | 打开文件/目录对话框 |
| `dialog:allow-save` | 保存文件对话框 |
| `dialog:allow-message` | 消息对话框 |
| `dialog:allow-ask` | 确认对话框 |

---

## 添加新权限

### 步骤 1: 确定需要的权限

查阅 [Tauri v2 权限列表](https://tauri.app/v2/api/js/permissions)。

### 步骤 2: 编辑 capabilities 文件

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "existing:permission",
    "new:permission:you:need"   // 添加新权限
  ]
}
```

### 步骤 3: 配置 Scope（如果需要）

对于 fs/shell 等权限，需要定义 scope：

```json
{
  "permissions": [
    {
      "identifier": "fs:allow-read",
      "allow": [
        { "path": "$HOME/**" },
        { "path": "$DOCUMENT/**" }
      ]
    }
  ]
}
```

---

## 命令参数安全

虽然 Tauri 提供了权限系统，但命令参数仍需在后端校验：

### 路径参数校验

```rust
#[tauri::command]
fn add_project(path: String, ...) -> Result<Project, String> {
    // 1. 类型校验
    if path.is_empty() {
        return Err("Path cannot be empty".into());
    }

    // 2. 路径规范化（防止路径穿越）
    let canonical = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("Invalid path: {}", e))?;

    // 3. 范围限制（可选）
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    if !canonical.starts_with(home) {
        return Err("Path must be within home directory".into());
    }

    // ... 业务逻辑
}
```

### 长度与格式校验

```rust
// 项目名称校验
if name.len() > 255 {
    return Err("Project name too long".into());
}
if name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
    return Err("Project name contains invalid characters".into());
}
```

---

## 常见错误

### 1. 权限未添加导致运行时错误

```bash
# 错误：未配置 fs 权限
Error: permission denied: fs:allow-read
```

**解决**：在 capabilities 中添加对应权限。

### 2. Scope 过于宽泛

```json
// 不安全 —— 允许访问整个文件系统
{ "fs:allow-read", "allow": [{ "path": "**" }] }

// 安全 —— 限制在特定目录
{ "fs:allow-read", "allow": [{ "path": "$HOME/**" }] }
```

### 3. CSP 配置不当

```json
// 开发环境可用，但生产环境应配置
"security": {
  "csp": null  // 允许所有脚本
}

// 生产环境建议
"security": {
  "csp": "default-src 'self'; script-src 'self'"
}
```

---

## 相关文档

- [Tauri v2 Security](https://tauri.app/v2/security/)
- [Tauri v2 Capabilities](https://tauri.app/v2/security/capabilities/)
- [Tauri v2 Permissions](https://tauri.app/v2/api/js/permissions/)