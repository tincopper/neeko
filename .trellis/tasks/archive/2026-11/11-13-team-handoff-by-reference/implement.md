# implement — 交接改引用制（共享区 + artifacts 可写 + 拒绝截断）（TDD）

> 改动面：`src-tauri/src/common/paths.rs` · `src-tauri/src/agent/team/{identity/env,
> identity/preamble,delivery,manager,mcp/schema,mcp/dispatch,store}.rs` ·
> `src-tauri/src/app/team_executor.rs` · `src-tauri/src/app_state.rs` ·
> `src/features/agent-team/components/TeamTaskCenterView.tsx` 及测试。零迁移、零新事件。

## 动手前（硬指令）

- [x] Read `src-tauri/AGENTS.md`（红线 3/8）与 `src/AGENTS.md`（红线 12/17）。
- [x] Read 本任务 `prd.md`（R1-R6 / AC1-AC7 / Non-Goals；共享区根 = Neeko 状态根，
      2026-11-13 用户裁决）。
- [x] Read `.trellis/spec/backend/team-domain.md` §2.2（执行参数不随工具回复走）、
      §2.5（artifacts / summary 语义）、§8.2（载荷有界）。

## 关键设计（三条纪律）

1. **路径拼装只有一份**：`paths::team_share_dir_under(root, team_id)` 是唯一拼装
   （`root/team/<team_id>/share`）；`team_share_dir(team_id)` = 默认根（`~/.neeko`）的
   生产装配。执行层与管理器的校验都从**同一个 state_root**（组合根传
   `storage_manager.get_config_dir()`）派生 —— 与成员隔离配置目录同一个 base，
   团队删除时随目录一起收走。
2. **校验在 manager、单一写入口**：summary 长度、artifacts 路径安全都拦在
   `update_task`（store 层截断降级为边界兜底，且**不再无声洗掉**老行的
   `summary_truncated` 标记）。manager 持 share root（构造时给；测试可指 tempdir）。
3. **前缀不占预算**：`team_send` 的 2 KiB 上限只算 `message` 正文，`[team] {from}: `
   前缀不算 —— 算法钉在测试里。

## 阶段 A：路径 + env（R1 前半，AC1）

- [x] A1 红：`paths` 测试 —— `team_share_dir` 绝对路径、`~/.neeko` 之下；`_under` 与
      默认根装配一致。
- [x] A1 绿：`paths::team_share_dir_under` / `team_share_dir`。
- [x] A2 红：`env` 测试 —— member_env 注入 `NEEKO_TEAM_SHARE_DIR`（常量值断言）。
- [x] A2 绿：`identity::TEAM_SHARE_DIR_ENV` + `member_env` 加 share_dir 入参（调用点
      = plan_member_spawn，从 state_root 派生）。

## 阶段 B：共享区 provisioning（R1 后半，AC1 执行层）

- [x] B1 红：executor 测试 —— `ensure_share_dir(root, team)` 在 tempdir 下创建目录；
      已存在为幂等。
- [x] B1 绿：`app/team_executor.rs::ensure_share_dir`（fs，阻塞 —— 调用方已在
      spawn_blocking），在 start_member 起进程**之前**调用，失败即拒绝启动。

## 阶段 C：summary 拒绝（R3，AC3）

- [x] C1 红：manager 测试 —— 超 4 KiB `summary` ⇒ `InvalidInput`（文案含
      `NEEKO_TEAM_SHARE_DIR` 与 artifacts 指引）；恰好等于上限 ⇒ 通过（闭区间）。
- [x] C1 绿：`update_task` 校验 + 写新 summary 时置 `summary_truncated=false`；
      `create_task` / `retry_task` 摘掉 `clamp_task_summary`（retry **不得**重写老行标记 ——
      测试钉住）。
- [x] C2 绿：store `upsert_task` 的 clamp 降级为兜底：未发生截断时**保留**行上
      `summary_truncated`（老标记不被任何重写洗掉）；发生截断则置 true。

## 阶段 D：artifacts 可写（R2，AC2）

- [x] D1 红：manager 测试 —— `task_update` 带 `artifacts` 落库并可读回；
      相对路径 / 越界路径 ⇒ `InvalidInput`；重复 (kind, value) 不追加；
      `None` = 不动既有 artifacts。
- [x] D1 绿：`update_task` 加 `artifacts: Option<&[Artifact]>`（追加 + 去重）；
      path 类必须绝对 + canonicalize + 在团队根或共享区之下（红线 8）；
      `TeamManager` 持 share root（`with_share_root` / `load(store, root)`；
      生产 = `storage_manager.get_config_dir()`）。
- [x] D2 红+绿：dispatch `update` 解析 `artifacts` 数组（kind 枚举 / value 非空）；
      `schema::TOOLS` 的 `task_update` input_schema 同步（红线 14）；既有测试调用点补
      `None`（机械修改）。

## 阶段 E：team_send 限长（R4，AC4）

- [x] E1 红：delivery 测试 —— 2048 字节正文通过（**前缀不计入**）、2049 拒绝
      （文案指向共享区）。
- [x] E1 绿：`delivery::MESSAGE_MAX_BYTES`（2 KiB）+ `ensure_message_fits`；
      `dispatch::send` 在校验链里调用。

## 阶段 F：preamble 共享区说明（R5，AC5）

- [x] F1 红：preamble 测试 —— 两种角色都含共享区交接说明，且断言的是常量**值**
      （`TEAM_SHARE_DIR_ENV`），不是字面量；预算测试仍绿。
- [x] F1 绿：`identity_block` 加一行（唯一落点；工具描述与别处不得重复该地址）。

## 阶段 G：前端（R6，AC6）

- [x] G1 红：`TeamTaskCenterView.test.tsx` —— artifacts 渲染路径值（手写电线载荷，
      与 §8.2 同纪律）；`summaryTruncated: true` 时「已截断」提示可见。
- [x] G1 绿：artifact chip 点击复制路径（`useCopyToClipboard`，不新开 tab 类型）；
      截断提示已有则只补测试。

## 阶段 H：收尾

- [x] H1 `cargo test --lib agent::team` + `paths` 全绿。
- [x] H2 `pnpm check:quick`（只跑一次）。
- [x] H3 spec 同步：team-domain.md §2.5（summary 拒绝 / artifacts 语义 / 共享区 /
      store 兜底新语义）、§2.2（member_env 三件套）、§3.3 表（共享区目录）、
      §1（`load(store, root)` 构造签名）。
- [x] H4 会话记录 + 归档。

## 判据汇总（谁红说明哪里退化了）

| 退化 | 变红的测试 |
| --- | --- |
| 静默截断回来了 | C1 的超长拒绝 + AC3 闭区间 |
| 老行 truncated 标记被洗掉 | C1 retry 保留标记 + C2 store 保留标记 |
| artifacts 越界 / 相对路径混进来 | D1 两条拒绝 |
| 前缀占了 message 预算 | E1 的边界断言 |
| 路径拼装出现第二份 | A1 的 `_under` 一致性 + 执行层/manager 共用同 root |
| 共享区地址写进第二处文案 | F1 的常量值断言 |
