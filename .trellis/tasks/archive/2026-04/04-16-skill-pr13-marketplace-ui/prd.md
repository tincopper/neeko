# PR#13: Marketplace UI — browse, search, install from market

## 概述

实现 SkillsPanel 的"Skill 市场"Tab，用户可以浏览 Skills.sh 排行榜、搜索 Skill、一键安装到本地 central repo。

## 依赖

- PR#9: Tab 布局（提供"Skill 市场"Tab 容器）
- PR#12: Marketplace 后端（API + 安装命令）

## 参考项目

- `skills-manager/src/views/InstallSkills.tsx` — Market tab
- `skills-manager/src/components/InstallToast.tsx` — 安装进度 toast

## 需求

### 1. Marketplace Tab 布局

```
┌──────────────────────────────────────┐
│ [本地 Skill] [Skill 市场] [项目 Skill] │
├──────────────────────────────────────┤
│ 🔍 Search marketplace...             │
├──────────────────────────────────────┤
│ [🔥 Hot] [📈 Trending] [⭐ All Time] │  ← Leaderboard 切换
├──────────────────────────────────────┤
│ ┌────────────────────────────────┐   │
│ │ 📦 vite                  ⬇ 152 │   │
│ │ antfu/skills                   │   │
│ │                      [Install] │   │
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ 📦 ai-sdk                ⬇ 265 │   │
│ │ vercel/ai                      │   │
│ │ ✅ Installed                   │   │
│ └────────────────────────────────┘   │
│ ...                                  │
└──────────────────────────────────────┘
```

### 2. 组件设计

#### `MarketplaceTab.tsx`
- 顶层容器，管理 leaderboard 类型和搜索状态
- 调用 `useMarketplace` hook

#### `MarketplaceSearchBar.tsx`
- 搜索输入框，debounce 300ms
- 输入时切换到搜索结果模式
- 清空时回到 leaderboard 模式

#### `LeaderboardToggle.tsx`
- 三个按钮：Hot / Trending / All Time
- 切换时调用 `fetchLeaderboard(board)`

#### `MarketSkillCard.tsx`
- 展示：name, source (owner/repo), installs 数量
- "Install" 按钮 → 触发安装
- 如果已安装（name 匹配本地 skill），显示"✅ Installed"
- 安装中显示 spinner + 阶段文字

### 3. `useMarketplace` Hook

```typescript
export function useMarketplace() {
  // State
  const [leaderboard, setLeaderboard] = useState<SkillsShSkill[]>([]);
  const [searchResults, setSearchResults] = useState<SkillsShSkill[]>([]);
  const [board, setBoard] = useState<"hot" | "trending" | "alltime">("hot");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());

  // Actions
  const fetchLeaderboard: (board: string) => Promise<void>;
  const searchMarketplace: (query: string) => Promise<void>;
  const installFromMarket: (source: string, skillId: string) => Promise<void>;

  return { leaderboard, searchResults, board, setBoard, searchQuery, setSearchQuery,
           loading, installingIds, fetchLeaderboard, searchMarketplace, installFromMarket };
}
```

### 4. 安装进度监听

使用 Tauri event listener 监听 `install-progress`：

```typescript
import { listen } from "@tauri-apps/api/event";

useEffect(() => {
  const unlisten = listen<InstallProgress>("install-progress", (event) => {
    const { skill_id, phase } = event.payload;
    if (phase === "done") {
      // 从 installingIds 中移除
      // 刷新本地 skill 列表
      // 显示成功 toast
    } else if (phase === "error") {
      // 显示错误 toast
    }
  });
  return () => { unlisten.then(fn => fn()); };
}, []);
```

### 5. 已安装检测

Marketplace 列表需要与本地已安装 skill 交叉检测：
- 从 `get_managed_skills()` 获取已安装列表
- 对比 `source_ref` 或 `name` 匹配
- 已安装的 skill 显示"Installed"标记而非"Install"按钮

### 6. 前端缓存

在 hook 内缓存 leaderboard 结果（React state 级别），避免 Tab 切换时重复请求。

## 验收标准

- [ ] "Skill 市场"Tab 展示 Skills.sh 排行榜
- [ ] 三种排行榜（Hot/Trending/All Time）切换正常
- [ ] 搜索功能正常（debounce + 结果列表）
- [ ] "Install" 按钮触发安装流程
- [ ] 安装过程显示进度（cloning → installing → done）
- [ ] 安装完成后自动刷新本地 Skill 列表
- [ ] 已安装的 Skill 显示 "Installed" 标记
- [ ] 网络错误有友好提示
- [ ] `npx tsc --noEmit` 通过

## 不包含

- Git URL 手动安装（可后续扩展）
- SkillsMP.com 集成（暂不需要）
- 安装取消功能
