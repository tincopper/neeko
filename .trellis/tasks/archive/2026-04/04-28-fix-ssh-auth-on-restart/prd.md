# fix-ssh-auth-on-restart

## Goal

修复远程 SSH 项目在应用退出后重新进入时，无法自动恢复鉴权连接，提示 "Authentication required / Waiting for credentials..." 的问题。

## What I already know

### 数据流

1. **Auth 持久化**：`RemoteAuthDialog` 中用户勾选"记住密码"时，`btoa(JSON.stringify(auth))` 编码后存入 `RemoteEntrySession.saved_auth`，随 `save_session` 写入 `sessions.json`
2. **Auth 恢复**：`useSessionBootstrap` → `load_session` → `restoreAuthFromEntries` 解码 `saved_auth` 写入 `remoteAuthStore`（Zustand Map）
3. **Auth 检查**：`useRemoteProjects.ts:57-68` effect 依赖 `remoteAuthStore`，当 `remoteAuthStore.has(entryId)` 为 false 时设置 `pendingAuthEntry` 触发弹窗
4. **UI 渲染**：`RemoteProjectView` 在 `remoteAuthStore.get(entry.id)` 为 undefined 时显示 "Authentication required"

### 已确认的两个根因

#### 根因 1：saved_auth 未持久化（主因）

`RemoteAuthDialog` 中 `saveCredentials` 默认为 `false`。用户不勾选"记住密码"时，`encodedAuth` 为 `null`，auth 仅存在于内存中的 `remoteAuthStore`。应用重启后内存清空，auth 丢失。

**关键代码** `RemoteAuthDialog.tsx:55`：
```ts
const encodedAuth = saveCredentials ? btoa(JSON.stringify(auth)) : null;
```

#### 根因 2：启动时序竞态

`useSessionBootstrap.ts:28-41` 中：
```ts
invoke<SessionStore>("load_session").then((session) => {
    deps.setRemoteEntries(remoteE);        // ① 触发 remoteEntries 更新
    deps.restoreAuthFromEntries(remoteE);  // ② 触发 remoteAuthStore 更新
    setInitializing(false);                // ③ UI 渲染
});
```

`restoreAuthFromEntries` 内部调用 `setRemoteAuthStore`（Zustand setState），这是一个异步状态更新。虽然 React 18 会批处理 ①②③，但如果 `useRemoteProjects.ts:57-68` 的 effect 在 `remoteAuthStore` 更新前触发（例如 `activeRemoteProject` 从其他来源变化），会误判为无 auth。

## Requirements

1. 应用重启后，已保存凭据的远程项目应自动恢复 auth 状态，不弹出认证对话框
2. 用户未保存凭据时，行为不变（仍弹出认证对话框）
3. 启动过程中不应出现时序竞态导致的误弹窗

## Acceptance Criteria

- [ ] 应用重启后，已保存凭据的远程项目在选择时直接进入终端连接，不显示 "Authentication required"
- [ ] 未保存凭据的远程项目，选择时仍正常弹出认证对话框
- [ ] 启动过程中不会因时序问题误弹认证对话框
- [ ] `pnpm type-check` 通过
- [ ] `pnpm test:run` 通过

## Technical Approach

### Fix 1：修复启动时序（useSessionBootstrap.ts）

将 `setInitializing(false)` 放在 `restoreAuthFromEntries` **之后**，并确保 `remoteAuthStore` 更新完成后再渲染 UI。

当前 `restoreAuthFromEntries` 返回 `void`，需要改为返回 `Promise`，在 `setRemoteAuthStore` 回调中 resolve。

### Fix 2：优化 effect 依赖（useRemoteProjects.ts:57-68）

当前 effect 依赖整个 `remoteAuthStore` Map 对象引用。改为只在 `activeRemoteProject` 变化时检查 auth，避免 Map 引用变化触发不必要的重检查。

## Out of Scope

- SSH 连接超时机制（独立问题）
- SSH 连接池/复用（独立问题）
- 凭据加密存储（当前为 Base64 编码，安全性改进为独立任务）
- `KeyFileWithPassphrase` 前端 UI 支持

## Technical Notes

### 关键文件

| 文件 | 作用 |
|------|------|
| `src/hooks/useSessionBootstrap.ts` | 启动引导，加载 session 并恢复 auth |
| `src/hooks/useRemoteProjects.ts:57-68` | effect 检查 auth 并触发弹窗 |
| `src/hooks/useRemoteAuthActions.ts` | 认证成功回调，持久化 saved_auth |
| `src/components/RemoteProjectView.tsx:33-42` | 显示 "Authentication required" |
| `src/components/connections/RemoteAuthDialog.tsx` | 认证对话框，收集凭据 |
| `src/store/appStore.ts:40-41` | remoteAuthStore 和 pendingAuthEntry 状态 |

### restoreAuthFromEntries 当前实现

```ts
// useRemoteProjects.ts:137-156
const restoreAuthFromEntries = useCallback((entries: RemoteEntrySession[]) => {
    const restored = new Map<string, AuthMethod>();
    for (const entry of entries) {
        if (entry.saved_auth) {
            try {
                const auth: AuthMethod = JSON.parse(atob(entry.saved_auth));
                restored.set(entry.id, auth);
            } catch { /* ignore */ }
        }
    }
    if (restored.size > 0) {
        setRemoteAuthStore(prev => {
            const merged = new Map(prev);
            for (const [k, v] of restored) merged.set(k, v);
            return merged;
        });
    }
}, []);
```

`setRemoteAuthStore` 是 `useAppStore.setState` 的包装，返回 `void`。无法 await。
