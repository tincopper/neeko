# 修复切换项目时自动激活终端 tab

## 问题

切换项目（WSL/Remote/worktree）时，如果项目已有 terminal tab 但 active tab 是 file/diff tab，`ensureDefaultTab` 会强制激活第一个 terminal tab，打断用户的当前操作。

## 根因

`src/hooks/useTerminalTabs.ts` 第 97 行：`ensureDefaultTab` 在 terminal tabs 存在但 active tab 不是 terminal 时，无条件调用 `state.activateTab`。

## 修复

移除 `ensureDefaultTab` 中 terminal tabs 已存在时的强制激活行为。改为仅返回 terminal tab ID，由调用方决定是否激活。

## 影响范围

- `src/hooks/useTerminalTabs.ts` - 移除强制激活行
