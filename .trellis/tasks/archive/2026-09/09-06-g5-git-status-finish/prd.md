# G5 Git Status 路线收尾

> 来源：`.workbuddy/artifacts/git-changes-redesign-plan.md` 对照核查（2026-09-06）。
> 轻量任务：四项独立小改动，无独立 design.md，机制写在各项内。

## Goal

修复 G 路线落地后遗留的一处潜伏回归与三处计划偏差，使 git-changes-redesign-plan
的 G1–G4 阶段达到可关闭状态。XY 状态码契约（#1/#2）按建议独立立项，不在本轮。

## R1: v1 事件清理 + diff 自动刷新回归修复（#4）

- `useDiffData` 仍在监听后端已停发的 `git-status-diff`（G2 起废弃）——
  「仓库状态变化 → diff 自动刷新」链路已断（暂存/提交后 diff 视图不更新，
  只能手动刷新按钮）
- 修复：监听切换为 `git-status-snapshot`（v2，payload 含 project_id，语义等价：
  路径无关的仓库状态变化）
- 清理：`GIT_STATUS_DIFF_EVENT` 从后端 types.rs / mod.rs re-export 与前端
  events.ts 全部移除；events.ts 注释与事实对齐

## R2: 嵌套 .gitignore 分层加载（#3，P5）

- 现状：`GitIgnoreFilter::reload` 只加载根 `.gitignore` + `.git/info/exclude`，
  monorepo 子包规则对 watcher 事件治理不生效（读侧剪枝走 CLI `--ignored` 不受影响）
- 修复：reload 经 `ignore::WalkBuilder` 遍历收集全部嵌套 `.gitignore`
  （WalkBuilder 自身尊重 gitignore 语义，ignored 子树自动剪枝；`.git` 过滤；
  deep-first 天然后序 = 深层规则后加入 = 优先级正确）；上限 100 个文件防失控
- 嵌套 `.gitignore` 编辑触发 reload 的链路已存在（manager 按 file_name 匹配）

## R3: 截断上限统一 1000（#8，决策点 4）

- `MAX_CHANGED_FILES`（local/status.rs 兜底路径）500 → 1000
- `MAX_IGNORED_FILES`（operations/files.rs）500 → 1000
- `MAX_UNTRACKED_FILES` 保持 500（单目录按需展开，语义不同，注释说明）

## R4: G2 压测验收自动化替身（#7）

- G2 验收标准（/tmp/neeko-stress-repo 高频 touch + 心跳并发 + 切分支 → 零丢失零回退）
  无执行痕迹；以确定性 Rust 集成测试替身：临时仓库 + 并发 check 风暴 + 文件扰动 +
  切分支，断言 version 严格单调、最终 entries 与 porcelain 真值一致

## Non-Goals

- XY 状态码契约 / renamed old→new / ahead-behind 入快照（#1/#2，独立立项）
- libgit2 兜底路径字面退役（语义已由 version gate 收敛）
- afterOperation 显式 hook（index watcher 隐式覆盖）
- S2 排除式监听 / S4 虚拟化（S 路线，独立任务）

## Acceptance Criteria

- [ ] 全仓无 `GIT_STATUS_DIFF_EVENT` 引用；useDiffData 监听 git-status-snapshot
- [ ] 嵌套 gitignore 单测：monorepo 子包规则生效 + 深层覆盖浅层 + 根规则不受影响
- [ ] 截断上限统一后既有测试适配
- [ ] 压测替身测试通过（version 单调 + 最终一致）
- [ ] `cargo fmt` 全仓（顺带消除 G2 遗留格式漂移）+ `cargo test` + `pnpm lint` /
      `pnpm type-check` / `pnpm test:run` 全绿
