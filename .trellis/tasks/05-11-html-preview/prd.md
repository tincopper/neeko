# Task: html-preview

## Overview

为 Neeko 文件查看器增加 HTML 文件的渲染预览功能。当用户打开 `.html` / `.htm` 文件时，编辑器工具栏显示"预览"按钮，点击后新建一个独立的 `html-preview` Tab 页，使用 iframe sandbox 方式渲染完整 HTML 内容（含相对路径资源和 CDN 资源）。

## Requirements

### 1. 类型系统扩展

在 `src/types/tab.ts` 中新增：
- `TabKind` 联合类型添加 `"html-preview"`
- 新增 `HtmlPreviewTabData` 接口：
  ```typescript
  export interface HtmlPreviewTabData {
    kind: "html-preview";
    filePath: string;
    fileName: string;
  }
  ```
- 将其加入 `TabData` 联合类型

### 2. Store 层适配

在 `src/store/appStore.ts` 的 `mergeTabData` 函数中添加 `case "html-preview"` 分支。

### 3. HTML 预览组件

新建 `src/components/files/HtmlPreview.tsx`：
- 使用 **iframe + sandbox** 方式渲染 HTML
- sandbox 属性设为 `"allow-scripts allow-same-origin"` 以支持 JS 执行和 CDN 资源加载
- 通过注入 `<base href="...">` 标签指向文件所在目录的 asset URL，使相对路径的 CSS/JS/图片能正确解析
- 使用 Tauri 的 `convertFileSrc()` 将本地文件路径转为可访问 URL
- 当源文件内容变更时（通过 store 监听文件 tab 的 content 变化），自动刷新预览

### 4. Tab 路由

在 `src/components/MainContent.tsx` 的内容区域路由中添加：
```tsx
{activeTab?.data.kind === "html-preview" && (
  <HtmlPreview
    filePath={activeTab.data.filePath}
    fileName={activeTab.data.fileName}
  />
)}
```

### 5. 触发入口

在 `src/components/files/FileViewer.tsx` 的工具栏中：
- 判断当前文件扩展名是否为 `.html` 或 `.htm`
- 是则显示"预览"按钮（使用 `Eye` 或 `Globe` 图标，来自 lucide-react）
- 点击后创建新的 `html-preview` Tab，Tab ID 使用 `${projectId}:preview:${filePath}` 进行去重
- 如果已存在该文件的预览 Tab，则直接激活它

### 6. Tab 图标

在 `src/components/layout/UnifiedTabItem.tsx` 的 `getTabIcon` switch 中添加：
```typescript
case "html-preview": return Globe;  // 来自 lucide-react
```

### 7. Tauri 配置（如需要）

检查 `src-tauri/tauri.conf.json` 中 `security.assetProtocol` 配置，确保本地文件可通过 `convertFileSrc()` 访问。如需要，在 `capabilities/default.json` 中添加 `asset:default` 权限。

## Acceptance Criteria

- [ ] 打开 `.html` / `.htm` 文件时，编辑器工具栏显示"预览"按钮
- [ ] 点击"预览"按钮后新建独立的 `html-preview` Tab 页
- [ ] 预览 Tab 使用 iframe sandbox 渲染，HTML 内容完整展示
- [ ] 相对路径引用的本地 CSS/JS/图片能正常加载
- [ ] CDN 远程资源能正常加载
- [ ] 同一文件多次点击"预览"不会产生重复 Tab（去重）
- [ ] 预览 Tab 显示 Globe 图标
- [ ] 关闭预览 Tab 后资源正确释放（URL.revokeObjectURL）
- [ ] `pnpm type-check` 通过
- [ ] `pnpm lint` 通过
- [ ] 无功能回退

## Technical Notes

- **iframe sandbox 策略**：`allow-scripts` 允许 JS 执行，`allow-same-origin` 允许加载同源资源和 CDN 资源。不添加 `allow-top-navigation` 以防 HTML 跳转。
- **相对路径解析**：通过注入 `<base href="tauri://localhost/asset/{dir_path}/">` 使 HTML 内的相对引用基于文件所在目录解析。需确认 Tauri `convertFileSrc` 的实际 URL 格式。
- **Blob URL 生命周期**：组件卸载时需调用 `URL.revokeObjectURL()` 释放内存。
- **安全考量**：当前 `tauri.conf.json` 的 `csp: null` 已禁用 CSP，iframe sandbox 提供了基本隔离。后续可考虑更严格的 sandbox 策略。
- **参考模式**：现有 `FileViewer.tsx` 的 Markdown 预览/源码切换模式可作为 UI 参考，但 HTML 预览采用独立 Tab 而非切换模式。

## Out of Scope

- HTML 源码内嵌实时预览（分屏模式）
- HTML 文件编辑功能的改动
- WSL/SSH 远程项目的 HTML 预览（仅本地项目）
- CSP 安全加固
- HTML 预览的刷新按钮/自动刷新设置
