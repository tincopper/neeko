# C3 观测单流化：每 host 一条流 + 前缀索引 + manifest 缓存

## Goal

per-repo watcher 收敛为每 host/卷一条流 + 路径前缀索引；WatchManifest 按 (root, gitignore digest) 缓存；消除 FSEvents 排除根 8 上限截断与 ignore::walk 逐目录 DEBUG 落盘。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
