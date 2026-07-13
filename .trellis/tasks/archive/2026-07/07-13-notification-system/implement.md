# Implement: 通知系统

## 执行清单

### Step 1: 创建 notification feature 目录与基础设施

- [x] 创建 `src/features/notification/` + `src/features/notification/components/`
- [ ] 创建 `notificationTypes.ts`
- [ ] 创建 `notificationStore.ts`
- [ ] 创建 `components/index.ts`

### Step 2: 实现核心组件

- [ ] `NotificationButton.tsx`
- [ ] `NotificationList.tsx`
- [ ] `NotificationToast.tsx`
- [ ] `NotificationDetail.tsx`

### Step 3: 集成到 StatusBar

- [ ] 修改 `StatusBar.tsx` 右侧区域插入 `<NotificationButton />`

### Step 4: 质量检查

- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm test:run`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml`

## 验证命令

```bash
pnpm type-check
pnpm lint
pnpm test:run
```

## 回滚

- 删除 `src/features/notification/` 目录
- 恢复 `src/layout/StatusBar.tsx` 移除 NotificationButton 相关行
