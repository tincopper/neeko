# 架构债务清理：拆分 useAppShell / ProjectWorkspace 超大体量 + 全库深导入→门面标准化

## Goal

消除 neeko-check 报告中的 3 项既有架构债务，同时保持运行时行为完全不变：

1. **useAppShell 超大体量**（455 行 god hook，单一函数混编排/副作用/装配）
2. **ProjectWorkspace 超大体量**（432 行 > 300 行组件红线）
3. **代码库级导入约定不一致**（深导 vs 门面：dock wrappers 已修，但全库仍有跨 feature 深导未收敛）

## Requirements

- 拆分必须以「可独立测试的单元」为单位（hook / 纯函数），不允许纯搬移代码而无法验证。
- 拆分后不得改变任何运行行为：
  - hook 调用顺序 / effect 执行顺序与注册时机保持等价
  - 组件挂载语义（ProjectWorkspace keep-mounted、SkillContent 激活挂载）不变
  - store 写入、事件监听、ref 守卫等副作用语义逐一等价
- 深导入标准化遵循 AGENTS.md 防火墙白名单：
  - 可直导：`store/`、`types/`、`api/`
  - 其余跨 feature 引用一律走 feature `index.ts` 门面（组件/hooks/utils）
  - feature `index.ts` 缺公开符号时先补门面导出，再改消费方
- 每个新抽出的 hook / 纯函数必须有对应测试（TDD Red-Green-Refactor）。
- 同一 task 内不触碰并发进程文件：`events.ts`、`useFileTreeSync.ts`、`useGitHistory*`（已完成且合规）。

## Acceptance Criteria

- [x] `useAppShell.ts` 行数从 455 降到 ≤ 300（抽出 `useAppGlobalEffects` / `useAppStoreSync` / `useAppEntryAddRefresh` / `useAppInitialGitRefresh` + 装配段 `buildAppShellValues` + 数据编排 `useAppShellData`）→ **455 → 30 行**
- [x] `ProjectWorkspace.tsx` 行数从 432 降到 ≤ 300（抽出 `useProjectAgents` / `useTerminalTabs` / `useRemoteProjectSession` / `buildLayoutId`）→ **432 → 279 行**
- [x] 每个新抽出单元均有测试并通过（Red-Green-Refactor）→ useAppShell 侧 14 个 + ProjectWorkspace 侧 13 个 + buildAppShellValues 8 个，共 **35 个新测试全通过**
- [x] 全库跨 feature 深导入审计清零：`@/features/<f>/components|hooks|utils/...` 一律改门面（白名单 `store/` `types/` `api/` 除外）；门面缺符号的先行补导出 → **47 处修复，审计清零**（`shared/` 反向引用豁免见 design.md）
- [x] 质量门禁全绿：`pnpm lint:fe`（eslint + tsc + vitest typecheck）、`pnpm test:run` 全量通过、`cargo test` 不受影响 → **lint:fe 全绿；test:run 198 文件 1687 通过；cargo test 通过**
- [x] 同步相关 spec（如 quality-guidelines / directory-structure 若涉及新目录约定）→ quality-guidelines 新增「禁止跨 feature 深导入」条款；directory-structure 更新 app/hooks 说明

## Notes

- 本任务为**纯重构**：无新功能、无 bug 修复、无破坏性 API 变更。
- 拆分边界以「单一职责」为准：副作用类抽出为 hook，纯数据/字符串逻辑抽出为纯函数。
- 大型重构优先小步推进：每抽一个单元 → 跑对应测试 → 接入 → 回归，避免一次性大改。
- Keep `prd.md` focused on requirements / constraints / acceptance criteria；技术方案与进度见 `design.md` / `implement.md`。
