# 修复 SSH 命令状态机

## Goal

修正 SSH executor 中 PID 数据帧解析和 stdin 半关闭状态机，使合并帧的 PID 与首段输出正确分离，stdin 关闭后 bridge 继续接收输出和退出状态。

## Requirements

- PID 只解析首个换行符之前的字节；PID 行后已到达的字节必须作为 stdout 保留转发。
- 任意 SSH `ChannelMsg::Data` 帧边界不视为行边界；PID 可能跨多帧到达。
- 本地 stdin sender 关闭后 bridge 发送一次 channel EOF，但必须继续处理后续 channel 事件（Data、ExtendedData、ExitStatus、Eof）。
- 正常 stdin EOF 不得导致 `Killed` 错误。
- 提取 framing 和状态转换逻辑，以便用合成事件测试；不依赖真实 SSH 服务。
- 不改变认证、连接或 PTY/终端通道逻辑；只修复命令执行（exec）路径。

## Acceptance Criteria

- [ ] 模拟 `PID\n首段输出` 合并数据帧时，PID 正确解析且首段输出完整保留。
- [ ] PID 跨多个数据帧积累时正确解析。
- [ ] 模拟 stdin sender 关闭后，bridge 继续转发后续 stdout/stderr 和 ExitStatus。
- [ ] 模拟正常 stdin close + ExitStatus(0) 不返回 `Killed`。
- [ ] 定向测试（独立于 SSH 服务器）覆盖上述场景。
- [ ] executor/sync 中 SSH 相关测试不因已修复的 block_on 回归。
- [ ] `cargo test executor` 全部通过。

## Dependency

依赖子任务 1 的 `ExecChild`/`ExecOutput` contract。

## Out of Scope

- SSH 认证、连接、PTY 或终端通道修改。
- 其他两种 executor（Local、WSL）的修改。
- timeout/cancellation 机制增加。
