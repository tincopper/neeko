# Rust 最佳实践

> 业界通用的 Rust 开发最佳实践。项目特有约定见 [后端开发指南](../.trellis/spec/backend/index.md)。

---

## 1. 错误处理

- 显式处理所有 `Result`，用 `thiserror` 定义错误枚举，关键边界用 `?` 传导上下文，禁止吞错。
- 错误链使用 `anyhow::Context` 添加上下文信息，便于排查。

## 2. 所有权与借用

- 避免滥用 `.clone()`，优先引用 `&` 与借用。
- 用 `Result<T, E>` / `Option<T>` 防御性编程。

## 3. 命名与文档

- `snake_case` 命名；公开 API 写 `///` 文档注释。

## 4. 并发

- 共享状态用 `Mutex` / `RwLock`，避免跨 `await` 持锁。
- 阻塞 I/O 隔离到 `spawn_blocking`，保护主事件循环。

## 5. 类型驱动

- 优先用类型系统表达状态（`enum` + `match`），减少运行时分支判断。
- 有限策略集（≤5 种）用 Enum + match 而非 `Box<dyn Trait>`。

---

## 相关主题

- [后端质量指南](../.trellis/spec/backend/quality-guidelines.md) — Neeko 特有质量门禁与禁止模式
- [后端错误处理](../.trellis/spec/backend/error-handling.md) — anyhow、Result 模式、命令边界
- [后端并发指南](../.trellis/spec/backend/concurrency-guidelines.md) — 线程、Mutex、tokio、PTY/SSH I/O
