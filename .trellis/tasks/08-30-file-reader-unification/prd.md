# 文件读取统一中间层：AccessScope 策略 + 单源 read_file

## Goal

消除三份重复实现的文件读取逻辑（`read_file_content` / `read_file_blocking` /
`lsp_read_preauthorized_file`），统一为「一个核心 + 三个薄封装」，并借此补齐
WSL/SSH 远程项目的项目外预授权读取（消除本地-only 特例）。

## 设计

三个函数的真实差异只有三个维度，全部参数化：

- **安全边界** `FileAccessScope`：
  - `InProject { root }` —— canonicalize 后必须位于 root 内（默认拒绝，pillar 8）
  - `Trusted` —— 调用方已完成授权/信任校验（LSP 授权白名单 / 后端内部信任链）；
    reader 仍执行 canonicalize（防 symlink），fail-closed
- **通道** `ExecTarget`：Local 走 `std::fs`（spawn_blocking 隔离），
  WSL/Remote 走 `exec_on` shell（stat + cat，统一 exec facade）
- **防护参数** `max_bytes`（None=不限）/ `detect_binary`（NUL 检测）

对外契约零变化：`read_file_content` / `lsp_read_preauthorized_file` 命令名不变，
前端零改动（`definitionTarget` 语义增强除外）。

## Implemented（切片）

1. **核心** `common/file/reader.rs`：`read_file(scope, request)` + 9 用例
   scope 矩阵单测（root 内/外拒绝/Trusted 越界/symlink canonicalize/大小上限/
   二进制检测开关/缺失文件/base 相对路径）。
2. **`read_file_content` 命令薄封装**（InProject + detect_binary），删除
   services 的 `read_file_content` / `read_file_content_shell` / `is_binary_file`。
3. **LSP didOpen/预读切 Trusted**：删除 `read_file_blocking`；definition 预读
   补上 512KB 上限（原无上限）。
4. **`lsp_read_preauthorized_file` 切统一核心**：Trusted + 512KB；target 从
   manager 的 `project_exec_target` 取（未绑定回退 Local）——WSL/SSH 远程项目
   的项目外预授权读取从此可用（走 shell 通道），删除 `preauth.rs` 的本地
   blocking helper。
5. **前端 `definitionTarget` 语义增强**：常规读取失败后**无条件**尝试预授权
   回退——授权表命中与否即为项目内/外的权威裁决，消除对错误消息字符串匹配
   的依赖（`OUTSIDE_ROOT_MARKER` 退化为纯展示推断）；远程/WSL 的不同错误
   标记不再影响分类。

## 决策记录

- 三 scope 合并为两 scope（InProject/Trusted）：原设计的 Preauthorized 与
  InternalTrust 在 reader 层行为相同（授权校验在调用方），按 YAGNI 合并。
- WSL/Remote 的 InProject 远程 root 强校验为已知欠账（现状 shell 分支即无），
  行为保持迁移、补齐单独立项。
- LSP didOpen 保持无大小上限（行为保持）；预读/预授权 512KB。

## 验证

- `cargo test --lib common::file::reader` 9 用例、`lsp::` 82 用例，clippy 干净
- `pnpm lint:fe` 0 error / `pnpm type-check` / `pnpm test:run` 296 文件
  2359 passed（definitionTarget +1 远程回退用例）

## Out of Scope

- 远程 InProject 的 realpath 强校验（单独立项）
- 只读 tab 视觉徽标
