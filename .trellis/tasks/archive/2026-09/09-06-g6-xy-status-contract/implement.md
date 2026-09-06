# G6 Implement

## 顺序（TDD）

1. **Rust Red**：parsers/status.rs 测试新增 XY 提取用例（编译失败：字段不存在）
2. **Rust Green**：types.rs FileChange +3 字段；parse_status_line 填充；
   local/status.rs libgit2 → XY 映射 + 单测；验证 remote shell 路径透传
3. **TS Red**：ChangesList 分组用例（extractStatusGroups 纯函数先行）+ 类型扩展
4. **TS Green**：git.ts 类型；新纯函数 `gitStatusGroups`（放 features/git/utils，
   消费 shared 词表）；ChangesList 四组渲染 + rename old→new；
   gitFileDecoration.fileChangeToSummary XY 分桶（回退路径保绿）
5. **回归**：cargo test / pnpm test:run / lint / type-check

## 关键决策

- 分组逻辑提取为**纯函数**（可单测，UI 只渲染）——放 `features/git/utils/gitStatusGroups.ts`
- unversioned 展开复用 useUntrackedDirExpansion（status==='Untracked' 回退判定保留）
- 勾选选择按 path 全局（跨组共享 selectedFiles，现状即如此）
