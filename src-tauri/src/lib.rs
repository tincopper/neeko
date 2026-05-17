pub mod agent;
pub mod commands;
pub mod error;
pub mod git;
pub mod git_worker;
pub mod models;
pub mod opencode_theme;
pub mod pi_theme;
pub mod project;
pub mod remote;
pub mod skill;
pub mod storage;
pub mod task_runner;
pub mod terminal;
pub mod utils;
pub mod watcher;

mod app;
mod app_state;
mod logger;

pub use app::run;
pub use app_state::AppStateWrapper;
pub use error::AppError;
