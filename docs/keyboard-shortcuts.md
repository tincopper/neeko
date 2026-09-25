# 键盘快捷键

> **唯一事实源**：`src/shared/utils/shortcutRegistry.ts` 的 `defaultBinding` 字段
> （运行时展示与可改绑定在设置面板，处理逻辑在 `src/shared/hooks/useKeyboardShortcuts.ts` 按 `id` 分派）。
>
> 本文档**不复制绑定表**。历史上这张表抄在根 `AGENTS.md` 里，与代码漂移了 3 项仍未被发现
> （见下），任何静态副本都会重演同样的失效。需要全量清单时读注册表，或在设置面板查看。

## 与旧 `AGENTS.md` 表格的差异（2026-09-25 核对）

移入本文档时逐条比对了 `shortcutRegistry.ts`，旧表 7 行中有 3 行已不成立：

| 旧表声称 | 实际 | 依据 |
| --- | --- | --- |
| `Ctrl+R` 手动刷新终端 | **`Ctrl+Alt+R`**（`refreshTerminal`） | `defaultBinding: 'Ctrl+Alt+R'` |
| `Ctrl+Alt+T` / `Ctrl+W` 打开/关闭副终端 | `Ctrl+W` 现为 **`closeTab`（关闭标签页）**；注册表中不存在 `Ctrl+Alt+T` | `closeTab.defaultBinding` |
| `Escape` 关闭设置面板 | 注册表无此绑定，由设置面板组件自行处理，无法从注册表确认 | — |

仍然成立的 4 项：`Ctrl+[1-9]` 跳转第 N 个项目（`switchProject`）、`Ctrl+Q` 循环切换项目
（`cycleProject`）、`Ctrl+O` 在 IDE 中打开（`openIde`）、`Ctrl+N` 循环切换 Worktree
（`cycleWorktree`）。

## 给改绑定者的提醒

新增或修改绑定只改 `shortcutRegistry.ts`；不要在组件里再写一份 key 字符串判断 —— 那会让设置面板显示
与实际行为分叉，且 `category` 冲突（如 Dock 默认值刻意避开 `Ctrl+1..9` 的项目跳转）无法被集中校验。
