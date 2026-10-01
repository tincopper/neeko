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
frontend-build
backend-check (ubuntu-latest)
backend-check (macos-latest)
backend-check (windows-latest)
backend-test (ubuntu-latest)
backend-test (macos-latest)
backend-test (windows-latest)
backend-coverage
java-host-check
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
- PR 必须通过 CI 的 required jobs 才能合并：前端静态检查与单元测试 + 覆盖率地板、
  `frontend-build` 的生产打包（`pnpm build`，bundle 期问题不再溜到发版才炸）、三平台
  `cargo check` + `pnpm lint:rust` + `pnpm test:rust`（命令定义见 `package.json`，与本地
  commit/push 档同源）、`backend-coverage` 的 Rust 行覆盖率地板、`java-host-check` 的
  java host 编译与自检
- **本清单必须与 GitHub 实际保护规则逐字核对**：文档里列了、后台没加的，等于没有门
  （清单自身就出现过漏 `java-host-check` / `frontend-build` 而「效果」段照称的漂移，
  2026-10-01 补齐）。新增 CI job 时，package.json（若有脚本）→ ci.yml → 本文件三处同一
  commit 内改完
- `backend-coverage` 在**没动 Rust 的 PR 上会跳过重活但仍报成功**（job 常驻、步骤条件化）：
  若把判断挪到 job 级 `if`，required check 会一直 pending，PR 永远合不进去
- 跨平台编译问题在 PR 阶段被发现，不会延迟到打 tag
