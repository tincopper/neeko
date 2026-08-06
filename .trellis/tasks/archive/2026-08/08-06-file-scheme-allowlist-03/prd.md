# file:// 路径白名单(P1)

## Goal

限制内置浏览器 `file://` 导航目标,防止浏览任意本地文件(如 `file:///etc/passwd`、SSH 密钥)。

## Requirements

* `validate_url_scheme`(src-tauri/src/browser/commands.rs)对 `file://` 增加路径边界校验:仅允许项目工作区目录内路径(以 `~/.neeko` 缓存目录或项目根为基准)
* 超出白名单的 file:// 返回 `AppError::InvalidInput`
* 白名单基准路径需在命令层可获取(项目根从既有 AppState 取,避免硬编码家目录)
* http/https 行为不变

## Acceptance Criteria

* [ ] `file://<项目根>/...` 放行,`file:///etc/passwd` 等越界路径拒绝
* [ ] 单元测试覆盖:白名单内放行、白名单外拒绝、路径穿越(`../`)拒绝
* [ ] 前端预览本地 HTML 功能(openHtmlInBrowserPanel)回归正常

## Out of Scope

* 取消 file scheme 支持(仍需用于本地 HTML 预览)
