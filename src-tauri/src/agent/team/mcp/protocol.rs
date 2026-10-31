//! MCP 团队端点的**线协议常量**：端点读的与客户端写的必须是同一份。
//!
//! # 为什么单独成文件
//!
//! 这些常量的消费者在**两侧**：端点（`mcp::server` 读 header、声明路由）与「我们下发给成员的
//! 客户端配置」（`execution::mcp_config_json` 写 header、拼 URL）。把它们留在 `server.rs` 会
//! 让 `execution` 依赖 HTTP handler 模块，而 handler 又依赖 `execution` 的端口 —— 两边互相
//! 依赖之后，任何一个都再也无法被单独理解。
//!
//! 放在 `mcp/` 的协议层，依赖方向变成单向：`server → protocol ← execution`。
//! 与 hooks 的 `ingest::validation::TOKEN_HEADER` 同一个思路（协议常量归协议层）。

/// 成员 token 的 header 名 —— **单一源**（下发的 MCP 配置、stdio bridge、测试断言全部引用它）。
///
/// 与 hooks 的 `x-neeko-agent-hook-token` 并列而不是共用：两套流量走不同 listener 与
/// 不同门实例（design §3.1b），共用一个名字只会让「拿 hook token 打团队端点」
/// 看起来像配置错误而不是越权。
pub const TOKEN_HEADER: &str = "x-neeko-team-token";

/// 端点路径（`server` 的路由声明与 `boot` 发布的坐标共用）。
pub const ENDPOINT_PATH: &str = "/team/mcp";
