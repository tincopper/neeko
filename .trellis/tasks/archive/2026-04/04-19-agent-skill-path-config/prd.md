# Agent Skill 路径配置优化

## 目标

优化 SettingsPanel 中 Agent 的 Skill 路径配置 UI，使其更加直观和易用。
skill路径不需要清除按钮

---

## 问题分析

### 当前实现问题

| # | 问题 | 描述 |
|---|------|------|
| 1 | 按钮不直观 | 使用 emoji (📁, +📁) 不够专业，用户不知道点击会打开文件夹选择 |
| 2 | 无路径显示 | 配置后没有显示已选择的路径是什么 |
| 3 | 无清除功能 | 已配置的路径无法清除 |
| 4 | 缺少标签 | 用户不知道这是"Skill 路径"配置 |
| 5 | 交互模糊 | 点击直接打开对话框，没有明确的取消操作 |

---

## 改进方案

### UI 布局

```
┌────────────────────────────────────────────────────────────────────┐
│ Built-in Agents                                               │
├──────────────────────────────────────────────────────────────┤
│ opencode  opencode                                            │
│            ↑ 命令                                               │
│  skill:  ~/.agents/skills                                     │
│           ↑ Skill 路径                                         │
├──────────────────────────────────────────────────────────────┤
│ Custom Agents                                                │
├────────────────────────────────────────────────────────────┤
│ MyAgent command: myagent     ×                            │
│            ↑ 命令             ↑ 清除                   │
│  skill:  ~/.agents/skills                                     │
│           ↑ Skill 路径   
└────────────────────────────────────────────────────────────┘
```

### 详细改进点

| # | 改进项 | 方案 |
|---|-------|------|
| A | Skill Path 标签 | 在命令后面显示 "Skill 路径:" 标签 |
| B | 显示已配置路径 | 已配置的路径以文字形式显示（如有配置） |
| C | 专用按钮 | 使用 `<FolderIcon />` 图标按钮替代 emoji |
| D | 悬停提示 | 添加 `title` 属性说明功能 |
| E | 布局调整 | 两行布局：命令在一行，Skill 路径在下一行 |

---

## 需求清单

### Built-in Agents
- [ ] 内置的Agents 都默认配置一个skill路径
  - claude skills路径默认为 ~/.claude/skills
  - opencode skills路径默认为 ~/.agents/skills
  - codex skills路径默认为 ~/.codex/skills
  - gemini skills路径默认为 ~/.gemini/skills
- [ ] 在每个 Built-in Agent 行下方添加 Skill 路径显示行
- [ ] 显示 "Skill 路径:" 标签 + 路径文字（如有配置）
- [ ] 路径显示为灰色斜体，无配置时显示 "未设置"
- [ ] 右侧添加文件夹图标按钮，点击打开目录选择对话框
- [ ] 悬停时显示完整路径

### Custom Agents

- [ ] 保持和Built-in Agents一样的布局，两行布局：命令在一行，Skill 路径在下一行
- [ ] 使用文件夹图标 + "路径" 文字按钮
- [ ] 已配置时显示路径文字 + × 清除按钮
- [ ] 悬停时显示完整路径
- [ ] 新增自定义 Agents的输入框新增一行skill路径输入配置，也可以自行通过文件选择的方式选择路径

### 交互逻辑

- [ ] 点击文件夹按钮 → 打开目录选择对话框
- [ ] 确认选择 → 保存路径到 `agentSkillPathOverrides`，也可以手工输入路径的方式
- [ ] 路径变更后自动保存配置

---

## 验收标准

### 功能验收

- [ ] Built-in Agent 可以设置 Skill 路径
- [ ] Custom Agent 可以设置 Skill 路径
- [ ] Custom Agent 可以清除已设置的路径
- [ ] 路径变更自动保存到配置
- [ ] 页面刷新后路径显示正确

### UI 验收
- [ ] 使用shadcn ui库进行设计
- [ ] 按钮使用图标而非 emoji
- [ ] 显示路径文字（有配置时）
- [ ] 悬停显示完整路径
- [ ] 布局清晰，标签明确

### 技术验收

- [ ] TypeScript 检查通过
- [ ] 不引入新的 console.log
- [ ] 不破坏现有功能

---

## 技术说明

### 相关文件

- `src/components/SettingsPanel.tsx` - Agent 配置 UI
- `src/types.ts` - `AgentConfig`, `AppConfig` 类型
- `src/hooks/useAppConfig.ts` - 配置管理

### 数据流

```
用户点击文件夹 → open() 对话框 → 用户选择目录 
  → selectSkillPath(agentId, path) 
  → 更新 config.agentSkillPathOverrides 
  → saveConfig(config) 
  → 持久化到后端
```

### 配置结构

```typescript
interface AppConfig {
  // ... 其他字段
  agentSkillPathOverrides: Record<string, string>;  // agentId -> path
}
```

---

## 现有代码参考

当前 SettingsPanel 中的相关代码结构：

```tsx
// 图标导入
import { FolderIcon, XIcon } from "./icons";

// 状态
const [skillPathEditingId, setSkillPathEditingId] = useState<string | null>(null);

// 获取路径
const getEffectiveSkillPath = (agentId: string, fallback: string | null | undefined) =>
  config.agentSkillPathOverrides?.[agentId] ?? fallback ?? "";

// 选择路径
const selectSkillPath = async (agentId: string, fallback: string | null | undefined) => {
  const selected = await open({ multiple: false, directory: true });
  if (selected) {
    const overrides = { ...(config.agentSkillPathOverrides || {}) };
    if (selected && selected !== fallback) {
      overrides[agentId] = selected;
    } else {
      delete overrides[agentId];
    }
    onConfigChange({ ...config, agentSkillPathOverrides: overrides });
  }
  setSkillPathEditingId(null);
};
```