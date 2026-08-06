# open_in_default_browser 消除 cmd 注入面(P0)

## Goal

消除 `open_in_default_browser` Windows 分支的 shell 注入面。

## Requirements

* 当前实现 `spawn_detached(&ExecTarget::Local, "cmd", &["/c", "start", "", &url])` 中 URL 经 `cmd` 解释,`&` / `^` / 引号可被消费,存在注入面
* 改为不经 shell 解释的方案:优先使用 `open` crate(内部走 ShellExecuteW),或保持 spawn_detached 但直接调用系统打开 API
* macOS `open` / Linux `xdg-open` 分支保持不变(无此问题)

## Acceptance Criteria

* [ ] Windows 分支不再以 `cmd` 为执行程序
* [ ] 含特殊字符 URL(如 `https://a.com/?q=a&b=2`)可正常打开且不被 shell 截断
* [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 通过(如引入 open crate,补充对应测试)

## Out of Scope

* URL scheme 白名单策略变更(仍限 http/https/file)
