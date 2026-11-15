# 成员间交接改为引用制：共享区路径 + artifacts 可写 + 取消静默截断

## Goal

长内容不再挤在「消息正文 / 任务摘要」这两个窄管道里：

- 文件类交付**只传路径**，对端按路径去读；
- 需要落地的长文本写进**团队共享区**（Neeko 状态根，不污染仓库）；
- `summary` / `team_send` 超限时**不再静默截断**，而是拒绝并给出可行动的下一步。

## 事故（本轮排查时真实发生）

`pi-arch` 完成的 t1 摘要被 `SUMMARY_MAX_BYTES = 4096` 截断在「现根目」三个字，
给 t2/t3 的硬约束整段丢失；它想把摘要补全，却因为「任务已 Done 不可再 update」彻底丢失。
→ 静默截断 = 一份看起来成功、实际少了内容的交接。

## 现状（已核）

| 位置 | 现状 |
| --- | --- |
| `store::clamp_summary` / `SUMMARY_MAX_BYTES` | summary 超 4096 字节 → **静默截断** + `summary_truncated` 标记；模型看不到「被截了」 |
| `TeamTask.artifacts: Vec<Artifact{kind, value}>` | 结构、列、视图都有，但**没有任何工具能写它**（生产里恒空） |
| `team_send.message` | 无长度上限；跨进程唯一通道是 PTY 字节流（长文本即长按键流） |
| 团队共享目录 | **不存在**（`~/.neeko/team/<team>/` 下只有成员配置目录） |

## 用户决策（2026-11-13）

共享区放 **Neeko 状态根**（`~/.neeko/team/<team_id>/share/`），不污染用户仓库。

## Requirements

- R1 新增团队共享区：`common::paths` 提供唯一的路径拼装（`team_share_dir(team_id)`），
  由执行层在成员启动前创建（与既有 `config_dir` provisioning 同层，失败即拒绝启动）。
  路径通过环境变量下发给成员（名字是常量，但**不是凭证**，不得走 `credentials_env`）。
- R2 `task_update` 增加可选 `artifacts`（数组，元素 `{kind, value}`，`kind` 沿用既有
  `ArtifactKind`）。写入走**同一个** manager 方法（不新增第二个写入口），并做路径校验：
  `Path` 类必须 canonicalize 且在允许根内（团队根 / 共享区），越界 → `InvalidInput`（红线 8）。
- R3 `summary` 超限改为**拒绝**：返回 `InvalidInput` + 可行动文案（把长内容写到共享区，
  用 `artifacts` 带路径，summary 只留结论）。`summary_truncated` 字段保留（老行还要读），
  但新写入不再产生截断。
- R4 `team_send.message` 加上限（初值 2 KiB，常量）并**拒绝超限**，文案同样指向共享区；
  投递文本前缀 `[team] {from}: ` 不计入上限的算法必须写死在测试里。
- R5 成员侧 preamble 增加一行「共享区在哪、长内容怎么交接」（`identity::preamble` 是唯一
  落点；不得在工具描述里各写一份地址）。
- R6 前端：任务详情的 artifacts 区块显示路径（可点/可复制——沿用现有详情面板能力，
  不新开 tab 类型），`summaryTruncated` 为真时给出**可见**提示（老数据才有）。

## Non-Goals

- 不做共享区的清理/垃圾回收（团队删除时随目录一起删，见 R1 的归属）。
- 不做「读文件」工具（成员有自己的文件系统工具；我们只负责给路径与契约）。
- 不改 sentinel 通道、不改 task body（body 本来就不在列载荷里、点开才拉）。
- 不做压缩 / 分片传输。

## Acceptance Criteria

- [ ] AC1 `paths::team_share_dir` 有单测（与 `db_dir` 同一条纪律：绝对路径、`~/.neeko` 之下）；
      成员启动后其环境里有该变量且指向已创建目录（执行层测试）。
- [ ] AC2 `task_update` 带 `artifacts` ⇒ 落库、`TaskCard.artifacts` 读得回；
      越界路径 ⇒ `InvalidInput`；相对路径 ⇒ 明确拒绝（不接受「按 cwd 猜」）。
- [ ] AC3 超长 `summary` ⇒ `InvalidInput`（**不是**静默截断），且错误文案含共享区变量名；
      恰好等于上限 ⇒ 通过（闭区间边界断言）。
- [ ] AC4 超长 `team_send.message` ⇒ 拒绝（`InvalidInput`），边界值同上。
- [ ] AC5 preamble 里出现共享区说明（纯函数测试断言片段），且**没有**第二处硬编码该路径。
- [ ] AC6 前端：artifacts 展示 + `summaryTruncated` 可见提示各一条组件测试。
- [ ] AC7 `pnpm check:quick` 绿 + team 域 `cargo test` 绿。

## Notes

- 与 `11-13-team-task-actions` 的关系：重试任务时会连 artifacts 一起保留（那是交接内容），
  本条必须先落地，actions 才能引用它。
- 与 `11-13-team-task-assignee-and-graph`：同属任务板字段面，但两处契约互不依赖，可并行。
- 红线：1（无新进程调用）、3（provisioning 在阻塞池）、4（长内容不进列表载荷）、
  8（路径 canonicalize）、14（`artifacts` 从「声明了就空」变为真的可写）、15（共享区是团队事实，
  不做 per-CLI 分支）。
