# Design: 通知系统

## 架构

### 分层

```
src/features/notification/
├── notificationTypes.ts         # 类型定义
├── notificationStore.ts         # Zustand store
├── components/
│   ├── index.ts                 # 统一导出
│   ├── NotificationButton.tsx   # StatusBar Bell 按钮
│   ├── NotificationList.tsx     # 下拉通知列表
│   ├── NotificationToast.tsx    # 浮动 toast
│   └── NotificationDetail.tsx   # 详情弹窗
```

所有通知组件通过 `src/features/notification/components/index.ts` 统一导出。

### 数据流

```
[任何 feature] → useNotificationStore.addNotification(…)
    ↓
notificationStore 更新 (notifications + unreadCount)
    ↓
NotificationToast 监听新通知 → 浮动显示 4s
NotificationButton 显示 unreadCount 角标
NotificationList 读取最近 10 条
```

### 状态设计 (Zustand Store)

```ts
interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (data: Omit<Notification, 'id' | 'timestamp' | 'read'>) => string;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}
```

- Store 上限 100 条，新通知插入 head，超出从 tail 丢弃
- `unreadCount` 由 store 维护，增删改读同步更新

## 组件设计

### 1. NotificationButton

- 使用 `lucide-react` 的 `Bell` 图标
- 使用 `@/ui/button` 的 `Button` variant="ghost" size="icon" 包裹
- 角标：绝对定位红色圆点 + 数字
- 外部点击关闭列表（与 LSP dropdown 相同模式）
- 位置：StatusBar 右侧 `<div>` 内，cursorPosition 之前

### 2. NotificationList

- 使用 `createPortal` 固定定位到 Bell 图标上方
- 宽度 320px，最大高度 400px
- 使用 `@/ui/ScrollArea` 实现滚动
- Header: "通知" 标题 + "全部已读" 操作按钮
- 列表项：左侧类型图标 → 中间 title+message 摘要 → 右侧相对时间
- 底部 "清空通知" 按钮（仅非空时显示）
- 空状态显示 "暂无通知"

### 3. NotificationToast

- 固定定位 bottom-6 right-12（避开 StatusBar 区域）
- 4s 后自动移除（setTimeout）
- 点击 → 打开通知列表 + 移除 toast
- 监听 store 变化：仅当列表未打开时显示
- 使用 CSS 动画滑入/滑出

### 4. NotificationDetail

- 使用 `@/ui/dialog` 的 `Dialog`
- 展示：类型图标 + 标题、完整消息、格式化时间
- 底部 "复制内容" 按钮（`navigator.clipboard.writeText`）

### 样式

- 颜色：
  - `info` → 蓝色
  - `success` → 绿色
  - `warning` → 黄色/橙色
  - `error` → 红色
- 所有组件使用 `cn()` + Tailwind utility classes

## 集成点

### StatusBar 变更

文件：`src/layout/StatusBar.tsx` 右侧区域：

```
<NotificationButton />
<Ln X, Col Y>
```

### App.tsx 变更

无变更。NotificationToast 自包含，不依赖 App.tsx 的 toast 体系。

### 向后兼容

- 不删除现有 `AppToast` / `useToast`
- 现有 toast 用于即时反馈，新通知系统用于持久化记录
