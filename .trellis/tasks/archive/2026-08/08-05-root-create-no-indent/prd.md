# 根目录新建文件/目录不需要缩进

## Goal

修复根目录（depth=0）新建文件/目录时内联输入行缩进与树节点不对齐的问题。根目录创建输入应使用与 depth=0 节点相同的缩进量，避免视觉跳跃。

## What I already know

### 渲染链路

1. **Header 按钮触发根目录新建** (`FilesPanel.tsx:108-113`)
   - `onCreateFile` → `state.startCreating(state.getCreationDir(), 'file')`
   - 无选中节点时 `getCreationDir()` 返回 `''`（根目录）
   - 有选中节点时返回选中目录或文件父目录

2. **根目录新建输入行渲染** (`FilesPanel.tsx:120-130`)
   ```tsx
   {state.creating && state.creating.dirPath === '' && (
     <InlineNameInput
       ...
       indent={16}   // ← 硬编码 16
     />
   )}
   ```

3. **树节点缩进公式** (`FileTreeNode.tsx:104`)
   ```tsx
   const indent = 4 + depth * 12;
   ```
   - depth=0 时 indent=4 → `paddingLeft: 4px`

4. **目录内新建缩进** (`FileTreeNode.tsx:213-214`)
   ```tsx
   indent={4 + (depth + 1) * 12}
   ```
   - 与同级子节点对齐，公式一致

5. **InlineNameInput 消费 indent** (`InlineNameInput.tsx:39`)
   ```tsx
   style={{ paddingLeft: indent }}
   ```

### 关键发现

| 场景 | 当前 indent | 期望 indent | 来源 |
|------|-------------|-------------|------|
| depth=0 树节点 | 4 | 4 | `4 + 0 * 12` |
| 根目录新建输入 | **16** | **4** | 硬编码 |
| depth=1 树节点 | 16 | 16 | `4 + 1 * 12` |
| depth=1 目录内新建 | 16 | 16 | `4 + (0+1) * 12` |

## Root Cause

`FilesPanel.tsx:128` 中根目录新建输入行的 `indent` 被硬编码为 `16`，而非使用与 depth=0 树节点一致的 `4`。

**视觉表现**：
- 树中根节点 `paddingLeft: 4px`
- 根目录创建输入 `paddingLeft: 16px`（比树节点深了 12px）
- 提交后新建节点以 `paddingLeft: 4px` 出现，输入行与结果节点产生 12px 的水平跳跃

**原因推测**：
- `16` 恰好等于 depth=1 节点的缩进量，可能是开发时复制目录内新建逻辑后忘记改为根目录公式
- 根目录输入行独立渲染在 `FilesPanel` 中（不在树内），缺少 `depth` 参数，导致开发者硬编码了一个值

## Assumptions (temporary)

- depth=0 树节点的 `indent = 4 + depth * 12 = 4` 是正确参考基准
- 根目录新建输入应与 depth=0 节点文本左对齐

## Open Questions

- [ ] 确认 `indent=4` 是否确实能让输入框文本与 depth=0 节点文本视觉对齐（需实测验证图标宽度差异）

## Requirements

- 根目录新建文件/目录输入行使用与 depth=0 节点一致的缩进量
- 目录内新建逻辑保持不变（已正确）
- 重命名行不受影响

## Acceptance Criteria

- [ ] 根目录新建输入行与 depth=0 树节点左对齐（无 12px 偏差）
- [ ] 提交后新节点位置与输入时视觉位置一致（无跳跃）
- [ ] 目录内新建（depth≥1）行为不变
- [ ] 右键根目录文件 → New File/Folder（`getCreationDir()=''`）同样对齐

## Definition of Done

- 代码修改完成
- `pnpm type-check` 通过
- `pnpm lint:fe` 通过
- 视觉验证对齐正确

## Out of Scope

- 不修改 tree 节点本身的缩进公式
- 不改 InlineNameInput 组件实现（仅调整调用参数）

## Technical Notes

- **受影响文件**：`src/features/file/components/FilesPanel.tsx`
- **修改点**：将 line 128 的 `indent={16}` 改为 `indent={4}`（或动态计算）
- **注意**：InlineNameInput 内部有 `w-3.5 h-3.5` spacer（14px）+ icon（16px），树节点有 chevron/icon，最终对齐可能需要微调
- **相关路径**：
  - `src/features/file/components/FileTreeNode.tsx:104` — 树节点缩进公式
  - `src/features/file/components/FileTreeNode.tsx:213-214` — 目录内新建缩进
  - `src/features/file/hooks/useFilePanelState.ts:225-228` — `getCreationDir` 逻辑
