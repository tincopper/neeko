# Webview 惰性回收策略(P3)

## Goal

每项目一个 webview 且无上限,内存随项目数线性增长(PRD 已知取舍)。增加惰性回收策略控制内存峰值。

## Requirements

* 定义回收阈值(如:隐藏超过 N 分钟的非活跃项目 webview 回收,建议 N=30;或 webview 总数上限,建议 8)
* 回收即 `browser_close` + `removeState`;项目切换回时按 store 中保留的 URL 重建 webview 并导航(恢复 URL,滚动位置/表单状态不保留——明确取舍)
* 回收策略需可配置/可关闭,避免破坏"切回保持完整状态"的既有体验
* 前端 hook 内实现定时检查(interval 或延迟调度),不阻塞主流程

## Acceptance Criteria

* [ ] 超过阈值的最久未用 webview 被回收,内存释放
* [ ] 回收后切回项目可重建并恢复到原 URL
* [ ] 活跃项目 webview 永不回收
* [ ] `pnpm type-check` + `pnpm test:run` 通过

## Out of Scope

* 进程级隔离(Arc 式进程池,需独立立项)
* 滚动位置/表单状态持久化(与"URL 持久化"同为既有 Out of Scope)
