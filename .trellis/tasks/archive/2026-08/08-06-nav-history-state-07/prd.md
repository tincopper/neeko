# 导航历史栈 + canGoBack 状态(P2)

## Goal

解决后退/前进按钮"虚亮"问题:当前按钮 disabled 仅依赖 `url` 是否存在,无法感知真实历史状态。

## Requirements

* 后端 `browser_go_back` / `browser_go_forward` 保持 `window.history.back()/forward()` 实现(行为不变)
* 前端基于 `browser://url-changed` / `page-loaded` 事件流维护每项目历史栈(store 或 hook 内):导航后 push,后退/前进后指针移动
* `canGoBack` / `canGoForward` 状态由历史栈指针派生,工具栏按钮按此 disabled
* 历史栈随项目隔离(states 按 projectId 索引)

## Acceptance Criteria

* [ ] 首屏无历史时后退按钮 disabled;导航后可用;后退到栈底再 disabled
* [ ] 多项目历史栈互不干扰(项目 A 后退不影响项目 B)
* [ ] `pnpm test:run` 通过(历史栈为纯逻辑,应有单元测试)

## Out of Scope

* 页面内 SPA 路由历史感知(依赖 url-changed 事件流,天然支持)
