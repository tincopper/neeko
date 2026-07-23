# Implement: 可扩展多 Agent 历史会话（L0–L3）

## Order of work

TDD：每步先写失败测试，再最小实现。

### Phase A — L0 扫描契约（阻塞后续）

1. [x] nested 目录 fixture + `scan` 断言
2. [x] `normalize_file_pattern` + `**/` 零段匹配
3. [x] 0 命中可观测性（log + ScanReport.errors）
4. [x] normalize / nested 单测
5. [x] manager nested 测试通过

### Phase B — L1/L2 门槛与对齐

6. [x] `adapters/README.md` checklist
7. [x] `default_agents` + `grok`
8. [x] registry 对齐测试
9. [x] `supportsResume` + 前端隐藏 Resume
10. [x] `grok.ico` 映射

### Phase C — L3 修复已有

11. [x] Codex：L0 后 nested 可达（既有 parse/resume 测试）
12. [x] Pi：同上
13. [x] Gemini/Qoder/CodeBuddy：L0 自动 `**/`（basename pattern）

### Phase D — L3 新增适配器

14. [x] OMP
15. [x] Grok
16. [x] Reasonix
17. [x] `all_adapters` 注册

### Phase E — 回归与验收

18. [x] `cargo test` conversation / adapters / agent defaults
19. [x] `vitest` conversation + agents（全量 pnpm 有无关失败）
20. [ ] 手工 History 面板（可选用户验证）
21. [x] AC1–AC10 对照见 prd 勾选

### Phase F — Codex polish (post L3)

22. [x] Codex `session_index.jsonl` lazy title lookup (orca-aligned)
23. [x] `$CODEX_HOME` for `session_root` when set
24. [x] Modern parser hardening: AGENTS.md / permissions filter, worker skip, real-session soft assert
25. [x] Focused cargo + vitest validation

## Validation commands

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
pnpm test
npx tsc --noEmit
```

聚焦（实现期按模块收窄）：

```bash
cargo test --manifest-path src-tauri/Cargo.toml conversation
cargo test --manifest-path src-tauri/Cargo.toml codex
cargo test --manifest-path src-tauri/Cargo.toml omp
cargo test --manifest-path src-tauri/Cargo.toml grok
cargo test --manifest-path src-tauri/Cargo.toml reasonix
```

## Risky files / rollback points

| 文件 | 风险 |
|------|------|
| `conversation/manager.rs` | L0 影响所有适配器扫描 |
| `agent/manager.rs` | Grok 默认列表变更 |
| `adapters/mod.rs` | 注册表 |
| 各新 adapter | 可单文件删除回滚 |
| 前端 ConversationItem / Dock resume | Resume 显示逻辑 |

**Rollback：** 先回滚 Manager normalize（改回各 adapter 显式 `**/`）可隔离；新 adapter 摘注册即可禁用。

## Dependencies between steps

- C/D **依赖** A（L0）
- D 中 Grok resume/icon **依赖** B 的 Grok AgentConfig
- E 在 C+D 后

## Out of implement scope

- L4 统一注册表
- recovery/subagent UI
- MessageBlock 全量统一

## Review gates before `task.py start`

- [x] prd.md 需求与 AC 完整
- [x] design.md 契约与适配器边界
- [x] implement.md 有序清单与验证命令
- [ ] 用户审阅通过
- [ ] implement.jsonl / check.jsonl 填入真实 spec 条目（sub-agent 模式）
