# 浏览器模块审查修复(neeko-check 发现)

## Goal

跟踪并修复 2026-08-06 对浏览器模块(内置 webview + picker + dock 联动)的设计审查发现的全部问题。
审查结论见会话记录:模块在 FDD/跨平台/事件注销/Skinny Controller 维度达标,存在 2 项硬违规
(事件名双端硬编码、commands.rs 混入 250 行注入脚本)与安全/体验/架构类差距若干。

## 审查发现清单(子任务映射)

| 子任务 | 优先级 | 问题 |
|---|---|---|
| `event-constants` | P0 | 事件名 `browser://*` 双端硬编码 12 处,违反 Review Gate #5 / shared/events.ts 契约 |
| `open-external-injection` | P0 | `open_in_default_browser` Windows 分支走 `cmd /c start`,存在 shell 注入面 |
| `file-scheme-allowlist` | P1 | `validate_url_scheme` 对 `file://` 无路径边界,任意本地文件可浏览 |
| `picker-channel` | P1 | picker 元素 HTML 经 `img.src` 查询字符串回传,有 URL 长度截断风险 |
| `browser-hook-refactor` | P1 | `useBrowserPanel` 581 行 + 5 段重复 listen 样板;hook 零测试 |
| `picker-script-extract` | P2 | `PICKER_SCRIPT` 250 行 JS 内嵌 Rust 字符串,无独立测试/语法检查 |
| `nav-history-state` | P2 | 后退/前进无状态感知,按钮虚亮;无标题/favicon 上报 |
| `browser-title-favicon` | P3 | 地址栏仅显示 URL,无页面标题与 favicon |
| `webview-reclaim` | P3 | 每项目一个 webview 无上限,无惰性回收策略 |

## Acceptance Criteria

- [ ] 全部 9 个子任务独立完成并归档
- [ ] 每个子任务修复后运行最小回归集:`pnpm type-check` + `pnpm lint:fe` + `pnpm test:run` + `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] 不引入行为回归:浏览器按项目隔离、picker 交互、项目切换 dock 决策保持原样

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / type-check / CI green
* Docs/notes updated if behavior changes

## Out of Scope (explicit)

* 多 tab 浏览器(PRD 既有 Out of Scope)
* URL 持久化/会话恢复(PRD 既有 Out of Scope)
* 浏览器进程池化(架构级,需单独立项)

## Pending Decision:DevTools Release 支持(待确认,2026-08-06)

**现状核查**:
- `src-tauri/Cargo.toml` 的 tauri 依赖**未配置 `devtools` feature**
- `browser_open_devtools` 命令用 `#[cfg(debug_assertions)]` 硬门控(commands.rs:174-180)
- 结果:开发环境(debug)DevTools 可用;`pnpm tauri build`(release)后命令体被裁掉,DevTools 不可用
- 权限层面已就绪:`capabilities/default.json` 的 `core:webview:default` 已含 `allow-internal-toggle-devtools`

**方案选项**:
- A(默认推荐):保持现状——开发默认开、发布默认关,符合安全默认;代价是正式包现场无法开 DevTools 排查
- B(release 可调试):Cargo.toml 加 `"devtools"` feature + 移除 `#[cfg(debug_assertions)]` 门控;注意 macOS(WKWebView)能力仍有限,主要对 Windows/Linux 有意义;需评估调试器暴露风险

**状态**:挂起,方案选择待确认。确认后若走 B,新建子任务或并入相关子任务实现。
