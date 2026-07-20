// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![doc = "Neeko desktop application — multi-project AI Agent session manager."]

/// Application entry point.
fn main() {
    neeko_lib::run();
}
