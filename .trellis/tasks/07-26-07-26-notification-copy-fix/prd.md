# 修复通知系统消息无法复制

## Goal

NotificationDetail 的 Copy 按钮调用 navigator.clipboard.writeText 失败时静默捕获，导致用户点击后无反馈。需要添加错误反馈、允许消息文本选中。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
