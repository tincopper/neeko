# 统一任务中心 · 实现路线图（设计后）

> 本阶段不写业务代码。确认 design + 原型后，再拆子任务 `task.py start`。

## 命名约束（实现时强制）

| 产品 | 代码 / 目录 | 禁止 |
| --- | --- | --- |
| **Tasks**（工作项面板） | `features/work-items`、`WorkItem` | 新代码用 `Task` 表示工作项 |
| **Launch**（原脚本 runner） | 文案先改；类型可暂留 `TaskConfig` | 新 UI 文案再写 Task Runner / Run 模块名 |
| **Agent** | 现有 agent 域 | 与 Tasks 列表混排为同一 inbox |

可选后续：**launch-rename** — `TaskConfig`→`LaunchConfig`、按钮/菜单文案、命令面板前缀 `Launch:`（独立子任务，不阻塞 Provider）。

## 建议子任务拆分

1. **work-items-core** — 类型、registry、store、query key、mock provider  
2. **provider-local** — 内置本地任务 Provider：CRUD、workflow stage 定义、transition、本地存储  
3. **work-items-ui-shell** — 单一面板（Board/List 双视图）：看板列卡片、列表分组 + 详情面板、筛选条、Source strip、Stage rail、Connect banner
4. **provider-github-pr** — 迁移 PullRequestsPanel → GitHub provider（list/detail/merge）  
5. **provider-github-issue** — Issues list/detail  
6. **provider-gitlab** — MR + Issue  
7. **provider-linear** — tickets + transition  
8. **provider-jira** — tickets + transition  
9. **integrations-settings** — Settings → Integrations 页面：Provider 卡片、连接/断开、项目绑定映射
10. **agent-actions** — Open in Agent / 上下文模板  
11. **launch-copy**（可选并行）— 产品文案 Task Runner → Launch  
12. **launch-rename**（可选靠后）— 类型与 IPC 符号 rename + 兼容  


## 依赖顺序

```
core → provider-local（内置本地任务 + workflow）
     → ui-shell（Board/List 单一面板、stage rail、source strip）
       → github-pr（替换旧入口）
       → github-issue
       → gitlab / linear / jira（可并行）
integrations-settings 可与 provider 并行，但 auth 完成前第三方 provider 只读 mock
```

## 验证（未来）

```bash
npx tsc --noEmit
pnpm test
# 手动：Tasks 面板 Board 首页默认展示、卡片列分布正确
# 手动：Board/List 视图切换正常、记忆用户选择
# 手动：Local 任务默认存在、第三方未连接时仅显示 Local
# 手动：本地任务详情展示 Stage rail、可执行 Transition
# 手动：GitHub 未登录 banner、打开 PR detail tab
# 文案抽检：侧栏 Tasks；启动配置处为 Launch；无双 Task 入口
```

## 回滚

- GitHub 迁移保留 feature flag：`workItems.githubProvider`
- 失败时恢复独立 Pull Requests dock 项
- Launch 文案可单独回退，不影响 Work Items

## 非目标

- 第一期不做离线全量同步
- 第一期不做跨平台写操作事务
- 第一期不强制 rename `features/task` 目录与全部 IPC
