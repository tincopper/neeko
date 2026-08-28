#![allow(unused_imports, missing_docs)]

pub mod diff_aggregator;
pub mod prompt;
pub mod service;

pub use diff_aggregator::get_selected_diff;
pub use prompt::{
    build_agent_commit_cmd, build_commit_prompt, build_simple_commit_prompt, clean_ai_output,
};
pub use service::{
    execute_agent_cli, execute_agent_cli_on_target, generate_commit_message, AgentInvokeConfig,
    AgentOutput,
};
