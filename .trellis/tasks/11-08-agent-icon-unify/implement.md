# Implement — AgentIcon 归位 + cli.svg 主题适配

## 执行记录（2026-11-08）

- 阶段 0-5 已完成，阶段 6 收尾中。
- **阶段 2/3 顺序已修正**：先搬家 `SessionList`，再删 shared `AgentIcon`（否则中间态构建红）。
- **D4 在执行中修订**：`ProjectSettingsDialog` **不搬**（多 feature 消费，仓库规范归 shared；
  搬家会引入 `connection → project → connection` facade 环）。改为保留 shared + 三处依赖注入
  （`renderAgentIcon` / `onSaveAgents` / `onSaveIde`）。详见 design.md 「D4 修订」。
- **FallbackImage 失败态改为派生态**（`failedFor === src`）：初版用 `useEffect` 重置被
  react-hooks 规则判违规（同步 setState 在 effect 里）。
- **trellis-check 抓到一个真 bug**：`'&#9889;'` 从 JSX 属性（会解码）变成函数实参（不解码），
  已改为 `'⚡'` 并补了一条字面量语义的测试。
- 验收：`pnpm test:fe` 741 文件 / 6882 用例全绿；`pnpm check:quick` 40/40 全通过；
  `pnpm lint:fe` / `pnpm type-check` 单独跑均绿。

执行顺序 = 依赖顺序。每个阶段末尾独立可验证、可回滚。

## 阶段 0：准备

- [ ] 确认工作区干净（`git status`），本任务不与其他改动混提
- [ ] 记录基线：`pnpm guards run check_component_size` 绿

## 阶段 1：新增 `FallbackImage`（纯展示，无 feature 依赖）

- [ ] 新建 `src/shared/components/FallbackImage.tsx`，按 `design.md` §4.1 实现
- [ ] 新建 `src/shared/components/__tests__/FallbackImage.test.tsx`
  - `src` 为 `null` → 渲染 fallback
  - `onError` → 切换 fallback（`fireEvent.error`）
  - `src` 变化后错误态重置（先 error，再改 `src`，应重新渲染 `<img>`）
  - 未传 `className` 时 inline style 尺寸 = `size`；传了则不注入
- [ ] 验证：`pnpm vitest related src/shared/components/__tests__/FallbackImage.test.tsx`

**回滚点**：删除新文件即可，无外部影响。

## 阶段 2：搬家 shared 的两个消费者（必须先于阶段 3）

> 顺序理由：`SessionList` / `ProjectSettingsDialog` 现在还 import shared 的 `AgentIcon`。
> 先搬家再删共享版本，构建才不会中途红。

- [ ] `git mv src/shared/components/SessionList.tsx src/features/live-sessions/components/SessionList.tsx`
- [ ] `git mv src/shared/components/__tests__/SessionList.test.tsx src/features/live-sessions/components/__tests__/SessionList.test.tsx`
  - 更新 test 内 import
- [ ] `features/live-sessions/components/UnitSessionList.tsx`：`@/shared/components/SessionList` → `./SessionList`
- [ ] `git mv src/shared/components/ProjectSettingsDialog.tsx src/features/project/components/ProjectSettingsDialog.tsx`
  - 目标处现有 re-export 壳（`export { default } from '@/shared/components/ProjectSettingsDialog';`）删除
- [ ] `features/connection/components/ConnectionProjectCard.tsx`：
  `@/shared/components/ProjectSettingsDialog` → `@/features/project`
- [ ] 处理注释引用（`shared/components/SessionRow.tsx` / `WorktreeRowList.tsx` 里提到
  `SessionList` 的路径描述）
- [ ] 更新 ratchet 基线路径：
  ```bash
  python3 - <<'EOF'
  import json, pathlib
  root = pathlib.Path(".")
  pats = ["src/**/components/**/*.tsx", "src/**/components/**/*.ts",
          "src/**/hooks/**/*.ts", "src/**/hooks/**/*.tsx"]
  files = {f for p in pats for f in root.glob(p) if f.is_file()}
  bad = {f.as_posix(): len(f.read_text(encoding="utf-8").splitlines())
         for f in files
         if "__tests__" not in f.as_posix()
         and not f.as_posix().endswith((".test.ts", ".test.tsx"))
         and not f.as_posix().startswith("src/testing/")
         and len(f.read_text(encoding="utf-8").splitlines()) > 300}
  json.dump({"max_lines": 300, "note": "…", "baseline": dict(sorted(bad.items()))},
            open("tools/guards/ledger/component_size.json", "w"), ensure_ascii=False, indent=2)
  EOF
  ```
  **先 diff**：只应出现 `ProjectSettingsDialog` 的键从 `shared/...` 变成 `features/project/...`；
  若出现无关条目 → 改为手工只替换这一条键，并在 note 里补一句「路径变更（搬家）」。
- [ ] 验证：`pnpm vitest related src/features/live-sessions/components/__tests__/SessionList.test.tsx`

**回滚点**：`git mv` 反向 + 还原 import + 还原基线。

## 阶段 3：`AgentIcon` 落到 `features/agent`，删除 shared 版本

- [ ] 把 `src/shared/components/AgentIcon.tsx` 的实现迁到
  `src/features/agent/components/AgentIcon.tsx`（替换现有 re-export 壳），
  按 `design.md` §4.2 实现；**删除 `eslint-disable` 注释**
- [ ] 删除 `src/shared/components/AgentIcon.tsx`
- [ ] `features/agent/index.ts` 的 `export { default as AgentIcon }` 保持不变
- [ ] 更新既有消费者 import（`@/shared/components/AgentIcon` → `@/features/agent`）：
  - `features/connection/components/RemoteDialog.tsx`
  - `features/connection/components/WSLDialog.tsx`
  - `features/project/components/AgentPopover.tsx`
  - `features/project/components/ProjectGuidePage.tsx`
  - `features/action-menu/components/ActionMenuDropdown.tsx`
  - `features/editor/components/AgentBar.tsx`
  - `features/editor/components/TabBar.tsx`
  - `features/conversation/components/ConversationPanel.tsx`
  - `features/conversation/components/ConversationItem.tsx`
  - `features/conversation/components/ConversationViewer.tsx`
  - `features/agent/components/AgentBar.tsx` / `AgentSelector.tsx`（`./AgentIcon` 不变）
  - `features/live-sessions/components/SessionList.tsx`（阶段 2 搬来的）
  - `features/project/components/ProjectSettingsDialog.tsx`（阶段 2 搬来的）
- [ ] 新建 `src/features/agent/components/__tests__/AgentIcon.test.tsx`
  - preset 图标 → `<img src>` 为解析后的 URL
  - `icon` 为自定义路径 → 走 `convertFileSrc` 分支（可 mock）
  - `icon` 为 `null` → 渲染 `fallback`
  - `fallback` 为字符串 → 包 `<span>`
- [ ] 验证：`pnpm vitest related src/features/agent/components/__tests__/AgentIcon.test.tsx`

**回滚点**：恢复 shared 文件 + 还原 import。

## 阶段 4：收编 14 个文件的裸 `<img>`

按 `design.md` §6 的映射表逐项迁移。建议顺序（先易后难）：

1. `settings/BuiltInAgentsSection.tsx`、`settings/CustomAgentsSection.tsx`
2. `skill/ImportToAgentDialog.tsx`、`skill/ImportToProjectDialog.tsx`
3. `skill/SkillCard.tsx`、`skill/AgentSkillCard.tsx`、`skill/AgentSkillContent.tsx`
4. `skill/ProjectSkillContent.tsx`（3 处）、`skill/ProjectSkillCard.tsx`（2 处）
5. `agent/AgentRailRow.tsx`、`agent/AgentForm.tsx`
6. `agent-chat/AgentBadge.tsx`、`agent-chat/ModelBadge.tsx`
7. `editor/TabItemLeading.tsx`

每项：

- [ ] 删除 `resolveAgentIconSrc` / `getAgentIconSrc` import（无其他使用时）
- [ ] 换成 `AgentIcon`（`ModelBadge` 换成 `FallbackImage`）
- [ ] 逐字核对：尺寸 class、`alt`/`title`、`data-testid`、`opacity`/`grayscale`、
      原 `else` 分支的兜底内容（首字母 chip → `fallback`）
- [ ] 相关测试文件同步更新（mock 点不变，但渲染断言可能需调整）

- [ ] 验证：`pnpm vitest related <每个改动的测试文件>`
- [ ] 全仓自检：`grep -rn "resolveAgentIconSrc\|getAgentIconSrc" src --include="*.tsx"`
      只应剩 `features/agent/api/agentApi.ts`（定义）、`features/agent/components/AgentIcon.tsx`
      （调用）、`features/agent-chat/components/ModelBadge.tsx`（`FallbackImage` 直用）

**回滚点**：按文件回退。

## 阶段 5：cli.svg 加底（D2 = A）

- [ ] 按 `design.md` §7 重写 `src/assets/agents/cli.svg`
- [ ] 验证：
  - `pnpm vitest related src/shared/utils/__tests__/agents.test.ts`（若涉及）
  - 目视：`pnpm tauri dev` 下分别在 `light` / `dark` / `classic-dark` / `one-dark-pro`
    主题查看侧栏纯 shell 会话行与设置页内置 agent 列表

**回滚点**：`git checkout src/assets/agents/cli.svg`。

## 阶段 6：收尾

- [ ] `pnpm check:quick`（唯一一次全量本地门禁）
- [ ] 补/改受影响测试，确保全量 `pnpm test` 不回归（`check:quick` 只覆盖改动文件相关）
- [ ] 同步 `.trellis/spec/frontend/` 相关文档（若 `directory-structure` / `state-management`
      里有组件归属或图标渲染的描述）
- [ ] `python3 ./.trellis/scripts/add_session.py --title "<title>" --commit "<hash>"`
- [ ] **不主动提交代码**

## 验证命令清单

```bash
# 单文件红绿（TDD 观察，非门禁）
pnpm vitest related src/shared/components/__tests__/FallbackImage.test.tsx
pnpm vitest related src/features/agent/components/__tests__/AgentIcon.test.tsx
pnpm vitest related src/features/live-sessions/components/__tests__/SessionList.test.tsx
pnpm vitest related src/features/agent-chat/components/__tests__/AgentBadge.test.tsx

# 护栏自检
pnpm guards run check_component_size
pnpm guards run check_feature_firewall_coverage

# 收尾唯一一次
pnpm check:quick
```

## 不做（YAGNI 边界）

- 不引入全局主题信号（D2 选 A）
- 不把 `resolveAgentIconSrc` 下沉到 shared（`convertFileSrc` 是 Tauri 边界，属于 features/agent）
- 不改 `AgentConfig.icon` 数据语义
- 不动 `ModelBadge` 的厂商兜底分类
- 不给 `AgentIcon` 加「主题变体」机制
