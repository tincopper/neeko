//! Pi 的**私有** rpc 协议适配器（`pi --mode rpc`）。
//!
//! # 为什么不用 ACP
//!
//! Pi 本身不说 ACP。`pi-acp`（npm 包）能翻译，但它是外层独立进程 ——
//! 会变成「pi-acp + pi」两个进程，用户已否决。这里直接对接 pi 的私有协议，
//! **单进程**。
//!
//! # 模块分工
//!
//! | 文件 | 职责 | 是否持有状态 |
//! | --- | --- | --- |
//! | `adapter.rs` | `AgentAdapter` impl（构造会话、声明能力） | 否 |
//! | `session.rs` | `AgentSession` impl + `ConfigOptionsState` + 握手 | **是** |
//! | `process.rs` | spawn / NDJSON 行读写 / 响应配对 | 连接态 |
//! | `translate.rs` | 单条事件 → `StreamEvent`（纯函数） | 否 |
//! | `config.rs` | Pi 响应 → `SessionConfigOption` 投影（纯函数） | 否 |
//!
//! 这个划分对应红线 9（`mod.rs` 只留声明与 re-export）。也更贴合真实依赖方向：
//! 翻译层是纯函数所以能被密集单测覆盖；状态只在会话层，进程层不认识 `StreamEvent`。
//!
//! # 三个协议事实（一手实测 pi 1.3.0）
//!
//! 1. **回合结束判据是 `agent_settled`**，不是 `agent_end` —— 后者在重试 / 压缩 /
//!    队列续跑时会发多次（详见 `translate.rs`）。
//! 2. `get_available_models` 返回**结构化对象**，`provider` 是独立字段，
//!    不需要拆 slug（模型 id 可能自带 `/`，如 `auto/x`）。
//! 3. `extension_ui_request` 在启动时就会来（扩展的 widget / status），
//!    与工具审批共用 `type`，必须按 `method` 分派 —— 所以 `approvals` 能力
//!    在接通审批之前声明 `false`。

mod adapter;
mod config;
#[cfg(test)]
mod integ;
mod process;
mod session;
mod translate;

pub use adapter::PiRpcAdapter;
