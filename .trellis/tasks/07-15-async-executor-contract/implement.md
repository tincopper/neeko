# Implementation Plan — 异步执行器收集契约

## TDD sequence

1. 添加 async runtime 调用测试，确认旧 `block_on` 路径失败。
2. 添加 stdout/stderr 高容量并发输出测试，确认旧串行读取超时。
3. 添加 stdin EOF 测试，确认旧收集器挂起。
4. 添加 fake output 非 UTF-8 与非零退出语义测试。
5. 添加非 Windows WSL factory/stub 测试。
6. 实现最小 `ExecOutput` 和 async child collector。
7. 实现 async `collect_output` 与 `exec_on`。
8. 统一 wait 数字退出语义和结构化 `CommandFailed`。
9. 收敛 WSL 模块和 constructor/factory。
10. 删除 `Handle::block_on`/`exec_sync` 实现。
11. 重构并保持全部红灯测试转绿。

## Validation

```bash
cargo test --manifest-path src-tauri/Cargo.toml executor
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
cargo check --manifest-path src-tauri/Cargo.toml
rg -n "Handle::block_on|exec_sync" src-tauri/src/common/executor
```

若下游调用方尚未迁移导致全 crate check 失败，应记录具体调用点并由依赖子任务修复；本任务自身定向测试必须通过，不得通过恢复 blocking shim 让旧调用点编译。

## Review gates

- 确认无输入模式确实关闭 stdin。
- 确认 stdout/stderr 真正并发 drain。
- 确认 collection 非零退出返回 output，而 convenience 层才返回 failure。
- 确认 raw bytes 未被提前 UTF-8 化。
- 确认 WSL cfg 差异不泄漏到 factory。

## Rollback point

在任何下游任务开始前完成此 API contract review；如需改签名，先回滚/修订本任务，不在多个调用方中打补丁。
