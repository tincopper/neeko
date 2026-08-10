# 分支保护规则配置

为确保代码质量，`main` 分支需要配置以下保护规则（Settings → Branches → Add rule）。

## 推荐配置

### Branch name pattern
```
main
```

### Protect matching branches

| 设置项 | 推荐值 | 说明 |
|--------|--------|------|
| **Require a pull request before merging** | ✅ 启用 | 禁止直接 push 到 main |
| **Require status checks to pass before merging** | ✅ 启用 | PR 必须通过 CI 才能合并 |
| **Require branches to be up to date before merging** | ✅ 启用 | 确保 PR 基于最新 main |
| **Do not allow bypassing the above settings** | ✅ 启用 | 管理员也必须遵守规则 |

### Required Status Checks

以下为 CI workflow 中的 job 名称，全部设为 required：

```
frontend-check
frontend-test
backend-check (ubuntu-latest)
backend-check (macos-latest)
backend-check (windows-latest)
backend-test (ubuntu-latest)
backend-test (macos-latest)
backend-test (windows-latest)
```

> **注意**：GitHub 会在 CI 第一次运行后自动识别 job 名称。首次配置时可以只添加 `frontend-check` 和 `backend-check (ubuntu-latest)`，后续再补全。

## 配置步骤

1. 进入仓库 **Settings** → **Branches**
2. 点击 **Add branch protection rule**
3. Branch name pattern 填 `main`
4. 勾选 **Require a pull request before merging**
5. 勾选 **Require status checks to pass before merging**
6. 搜索并添加上述 Required Status Checks
7. 点击 **Create** / **Save changes**

## 效果

- 开发者不能直接 push 到 main，必须通过 PR
- PR 必须通过全平台 `cargo check` + `cargo test` 才能合并
- 跨平台编译问题在 PR 阶段被发现，不会延迟到打 tag
