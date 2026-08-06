# PICKER_SCRIPT 抽离独立文件(P2)

## Goal

将 `commands.rs` 内嵌的 250 行 `PICKER_SCRIPT` JS 字符串抽离为独立文件,恢复命令层文件单一职责(当前 647 行,脚本与命令混杂)。

## Requirements

* 脚本抽到独立文件:`src-tauri/src/browser/picker_script.js`(或 assets 目录),Rust 侧 `include_str!` 引入
* `browser_start_picker` 拼接逻辑(theme + notify_base + script)保持
* 脚本内容不改动(行为不变);文件头加注释说明其被 `include_str!` 消费
* `commands.rs` 移除内嵌字符串,文件回归命令职责

## Acceptance Criteria

* [ ] `commands.rs` 无 250 行级内嵌脚本,脚本位于独立文件
* [ ] picker 功能回归:注入、高亮、选中、prompt 提交
* [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 通过

## Out of Scope

* 脚本逻辑重构(picker-channel 子任务范围)
