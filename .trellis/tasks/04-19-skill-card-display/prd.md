# 已安装 Skill 卡片展示组件

## 概述

重构已安装 Skill 的展示方式，使用 shadcn/ui Card 组件呈现，提供更丰富的卡片内容和操作能力。

## 依赖

- PR#4: 标签组合系统（Skill Tag Group）
- PR#6: SkillsPanel 前端 UI

## 需求

### 1. Card 组件

创建 `src/components/ui/card.tsx`：

```typescript
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "interactive" | "hoverable";
}
```

布局结构：
- `Card` — 根容器
- `CardHeader` — 头部（可选标题）
- `CardContent` — 内容区
- `CardFooter` — 底部（可选）

### 2. Skill 卡片展示

重构 `src/components/skills/SkillCard.tsx`：

#### 卡片内容布局

```
┌─────────────────────────────────────────────┐
│ Skill Name              [操作按钮列表 ▼]     │ ← CardHeader + 操作菜单
│ 描述文本...                            │ ← CardContent
│ [tag1] [tag2] [tag3]               │ ← CardContent (tags)
├─────────────────────────────────────────────┤
│ 📦 local  🤖🤖🤖  ● Enabled       │ ← CardFooter
└─────────────────────────────────────────────┘
```

#### 字段映射

| 位置 | 字段 | 说明 |
|------|------|------|
| 卡片头部 | `skill.name` | Skill 名称 |
| 卡片头部 | 操作菜单 | edit / delete |
| 内容区 | `skill.description` | 描述 |
| 内容区 | `skill.tags` | 标签列表 |
| 底部 | `skill.source_type` | 来源 (local/git/marketplace) |
| 底部 | 已安装 agents 图标 | 高亮已安装到的 agents |
| 底部 | 启用状态 | enabled/disabled |

### 3. 交互功能

#### 操作菜单（右上角）

- **编辑** — 打开 Skill 编辑对话框
- **查看** — 打开 Skill 内容面板
- **删除** — 确认删除弹窗

#### 已安装 Agents 图标

从 `skill_tool_toggles` 表查询该 Skill 被安装到的 agents，显示对应图标：
- opencode
- claude-code
- gemini

### 4. 现有数据结构复用

```typescript
interface ManagedSkillDto {
  id: string;
  name: string;
  description?: string;
  source_type: string;
  source_ref?: string;
  central_path: string;
  enabled: boolean;
  status: string;
  update_status: string;
  tags: string[];
  created_at: number;
  updated_at: number;
}
```

## 技术实现

### 1. UI 组件

新增文件：`src/components/ui/card.tsx`

```typescript
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";

const cardVariants = cva(
  "rounded-lg border border-border bg-bg-primary",
  {
    variants: {
      variant: {
        default: "",
        interactive: "cursor-pointer hover:border-accent hover:bg-bg-hover",
        hoverable: "hover:shadow-md transition-shadow",
      },
    },
  }
);

export function Card({ className, variant = "default", children, ...props }) { ... }
export function CardHeader({ className, ...props }) { ... }
export function CardContent({ className, ...props }) { ... }
export function CardFooter({ className, ...props }) { ... }
```

### 2. SkillCard 重构

重构 `src/components/skills/SkillCard.tsx`：

- 使用新建的 Card 组件
- 使用 DropdownMenu 组件实现操作菜单
- 使用 Badge ��件显示 tags
- 使用 Agent icon 显示已安装的 agents

### 3. Agent 图标映射

从 `src/utils/agents.ts` 复用 `AGENT_ICONS`：

```typescript
import { AGENT_ICONS } from "../utils/agents";

// 渲染已安装的 agents
const installedAgents = toolToggles.filter(t => t.enabled).map(t => t.tool);
```

## 验收标准

- [ ] Card 组件创建完成
- [ ] SkillCard 使用 Card 组件展示
- [ ] 卡片头部显示名称 + 操作菜单
- [ ] 卡片内容显示描述 + 标签
- [ ] 卡片底部显示来源 + agents 图标 + 启用状态
- [ ] 操作菜单功能正常（编辑/查看/删除）
- [ ] 类型检查通过

## 不包含

- 编辑对话框具体实现（后续任务）
- 删除确认弹窗具体实现（后续任务）
- Skill 内容面板（后续任务）