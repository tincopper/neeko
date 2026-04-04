# Skill 管理系统设计方案

## 概述

为 Neeko 多项目终端管理器设计一套 Skill 管理系统，支持用户创建、管理和执行可复用的技能。Skill 是 Agent 无关的，与项目关联，可在项目终端中直接执行。

**核心特性：**
- 4 种 Skill 类型：命令模板、工作流编排、Agent 能力声明、插件脚本
- 双层存储：项目级 `.neeko/skills/` + 全局 `~/.neeko/skills/`，项目优先
- Agent 无关：Skill 与项目关联，不绑定特定 Agent
- 终端执行：复用现有 PTY 终端机制，直接在项目终端中执行

---

## 1. 数据模型

### 1.1 目录结构

每个 Skill 是一个独立目录，包含 `skill.json` 清单文件和可选的资源文件：

```
~/.neeko/skills/                    ← 全局 Skill（所有项目可用）
├── code-review/
│   └── skill.json
├── deploy-staging/
│   ├── skill.json
│   └── scripts/
│       └── deploy.sh
└── full-ci/
    └── skill.json

<project>/.neeko/skills/            ← 项目级 Skill（仅当前项目可用，优先级更高）
├── db-migrate/
│   └── skill.json
└── custom-build/
    ├── skill.json
    └── scripts/
        └── build.sh
```

### 1.2 `skill.json` 清单格式

```jsonc
{
  "id": "code-review",              // 唯一标识，目录名一致
  "name": "Code Review",            // 显示名称
  "description": "Review code changes in the current branch",  // 功能描述
  "version": "1.0.0",              // 版本号
  "type": "command",                // 类型: "command" | "workflow" | "plugin"
  "tags": ["git", "review"],        // 分类标签

  // command 类型 —— 单条命令模板
  "command": "git diff --stat && git diff",
  "args": [                         // 可配置参数（可选）
    {
      "name": "branch",
      "description": "Target branch to diff against",
      "default": "main",
      "required": false
    }
  ],

  // workflow 类型 —— 多步骤编排（type 为 "workflow" 时使用）
  // "steps": [
  //   { "name": "Lint",  "command": "npm run lint",  "confirm": false },
  //   { "name": "Test",  "command": "npm test",       "confirm": false, "continueOnError": true },
  //   { "name": "Build", "command": "npm run build",  "confirm": true }
  // ]

  // plugin 类型 —— 外部脚本（type 为 "plugin" 时使用）
  // "entry": "scripts/deploy.sh"

  // 元信息（可选）
  "author": "user",
  "icon": "review.svg",
  "shortcut": "Ctrl+Shift+R"
}
```

### 1.3 TypeScript 类型定义

```typescript
// types.ts 新增

type SkillType = "command" | "workflow" | "plugin";

interface SkillArg {
  name: string;
  description: string;
  default?: string;
  required?: boolean;
}

interface WorkflowStep {
  name: string;
  command: string;
  confirm?: boolean;
  continueOnError?: boolean;
}

interface SkillManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  type: SkillType;
  tags: string[];
  // command
  command?: string;
  args?: SkillArg[];
  // workflow
  steps?: WorkflowStep[];
  // plugin
  entry?: string;
  // meta
  author?: string;
  icon?: string;
  shortcut?: string;
}

type SkillScope = "global" | "project";
```

### 1.4 Rust 后端数据结构

```rust
// state.rs 新增

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillType {
    Command,
    Workflow,
    Plugin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillArg {
    pub name: String,
    pub description: String,
    pub default: Option<String>,
    pub required: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub name: String,
    pub command: String,
    pub confirm: Option<bool>,
    pub continue_on_error: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    #[serde(rename = "type")]
    pub skill_type: SkillType,
    pub tags: Vec<String>,
    pub command: Option<String>,
    pub args: Option<Vec<SkillArg>>,
    pub steps: Option<Vec<WorkflowStep>>,
    pub entry: Option<String>,
    pub author: Option<String>,
    pub icon: Option<String>,
    pub shortcut: Option<String>,
}
```

---

## 2. 后端设计

### 2.1 SkillManager (`src-tauri/src/skill.rs`)

```rust
pub struct SkillManager {
    global_skills_dir: PathBuf,   // ~/.neeko/skills/
}

impl SkillManager {
    pub fn new(config_dir: &Path) -> Self;

    /// 扫描全局 + 项目目录，合并 skill 列表（项目同名 skill 覆盖全局）
    pub fn list_skills(&self, project_path: Option<&Path>) -> Vec<SkillManifest>;

    /// 读取单个 skill（按 id 搜索，项目优先）
    pub fn get_skill(&self, skill_id: &str, project_path: Option<&Path>) -> Option<SkillManifest>;

    /// 安装 skill 到指定 scope
    pub fn install_skill(&self, manifest: &SkillManifest, scope: &str, project_path: Option<&Path>) -> Result<(), String>;

    /// 删除 skill
    pub fn remove_skill(&self, skill_id: &str, scope: &str, project_path: Option<&Path>) -> Result<(), String>;

    /// 读取 plugin 类型的脚本内容
    pub fn read_plugin_entry(&self, skill_id: &str, scope: &str, project_path: Option<&Path>) -> Result<String, String>;

    /// 内置 skill 初始化（首次运行时创建）
    pub fn ensure_builtin_skills(&self) -> Result<(), String>;
}
```

**关键逻辑 — skill 合并策略：**

```rust
pub fn list_skills(&self, project_path: Option<&Path>) -> Vec<SkillManifest> {
    let mut skills: HashMap<String, (SkillManifest, SkillScope)> = HashMap::new();

    // 1. 先加载全局 skill
    if let Ok(entries) = fs::read_dir(&self.global_skills_dir) {
        for entry in entries.flatten() {
            if let Some(skill) = self.read_skill_dir(&entry.path()) {
                skills.insert(skill.id.clone(), (skill, SkillScope::Global));
            }
        }
    }

    // 2. 项目 skill 覆盖同名全局 skill
    if let Some(proj_path) = project_path {
        let proj_skills_dir = proj_path.join(".neeko").join("skills");
        if let Ok(entries) = fs::read_dir(&proj_skills_dir) {
            for entry in entries.flatten() {
                if let Some(skill) = self.read_skill_dir(&entry.path()) {
                    skills.insert(skill.id.clone(), (skill, SkillScope::Project));
                }
            }
        }
    }

    skills.into_values().map(|(s, _)| s).collect()
}
```

### 2.2 Tauri 命令（新增 5 个）

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `list_skills` | `project_path: Option<String>` | `Vec<SkillManifest>` | 扫描并返回合并后的 skill 列表 |
| `get_skill` | `skill_id: String, project_path: Option<String>` | `SkillManifest` | 获取单个 skill 详情 |
| `install_skill` | `manifest: SkillManifest, scope: String, project_path: Option<String>` | `()` | 安装到 global 或 project |
| `remove_skill` | `skill_id: String, scope: String, project_path: Option<String>` | `()` | 删除 skill |
| `save_skill` | `manifest: SkillManifest, scope: String, project_path: Option<String>` | `()` | 创建或更新 skill |

### 2.3 AppStateWrapper 扩展

```rust
// lib.rs 修改
pub struct AppStateWrapper {
    // ... 现有字段 ...
    skill_manager: SkillManager,       // 新增
}
```

### 2.4 内置 Skill（首次运行自动创建）

| ID | 名称 | 类型 | 内容 |
|----|------|------|------|
| `code-review` | Code Review | command | `git diff --stat && git diff` |
| `full-ci` | Full CI | workflow | lint → test → build（3 steps） |
| `clean-branches` | Clean Branches | command | `git branch --merged main \| grep -v main \| xargs git branch -d` |

---

## 3. 前端设计

### 3.1 新增文件结构

```
src/
├── hooks/
│   └── useSkills.ts                    ← Skill 状态管理 hook
├── components/
│   └── skills/
│       ├── index.ts                    ← 统一导出
│       ├── SkillPanel.tsx              ← Settings 中的 Skills tab
│       ├── SkillCard.tsx               ← 单个 skill 展示卡片
│       ├── SkillEditor.tsx             ← 创建/编辑 skill 表单
│       └── SkillExecuteDialog.tsx      ← 执行参数输入/确认弹窗
```

### 3.2 `useSkills` Hook

```typescript
// hooks/useSkills.ts

interface UseSkillsParams {
  activeProjectPath: string | null;
}

function useSkills({ activeProjectPath }: UseSkillsParams) {
  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<SkillManifest[]>("list_skills", {
        projectPath: activeProjectPath,
      });
      setSkills(list);
    } finally {
      setLoading(false);
    }
  }, [activeProjectPath]);

  const installSkill = useCallback(
    async (manifest: SkillManifest, scope: SkillScope) => {
      await invoke("install_skill", {
        manifest,
        scope,
        projectPath: activeProjectPath,
      });
      await loadSkills();
    },
    [activeProjectPath, loadSkills]
  );

  const removeSkill = useCallback(
    async (skillId: string, scope: SkillScope) => {
      await invoke("remove_skill", {
        skillId,
        scope,
        projectPath: activeProjectPath,
      });
      await loadSkills();
    },
    [activeProjectPath, loadSkills]
  );

  const saveSkill = useCallback(
    async (manifest: SkillManifest, scope: SkillScope) => {
      await invoke("save_skill", {
        manifest,
        scope,
        projectPath: activeProjectPath,
      });
      await loadSkills();
    },
    [activeProjectPath, loadSkills]
  );

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  return { skills, loading, loadSkills, installSkill, removeSkill, saveSkill };
}
```

### 3.3 UI 集成点

#### 3.3.1 SettingsPanel — 新增 "Skills" tab

在现有 5 个 tab（Editor、Terminal、Agents、IDE、Git）后新增第 6 个 tab。

布局结构：

```
┌─────────────────────────────────────────────────┐
│ Editor │ Terminal │ Agents │ IDE │ Git │ Skills │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─ Built-in Skills ─────────────────────────┐  │
│  │ 📋 Code Review    command   [▶ Run]       │  │
│  │    Review code changes in project         │  │
│  │ 🔄 Full CI         workflow  [▶ Run]      │  │
│  │    Run lint, test, build sequence         │  │
│  │ 🧹 Clean Branches  command   [▶ Run]      │  │
│  │    Remove merged branches                 │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌─ Global Skills ───────────────────────────┐  │
│  │ 🚀 Deploy Staging  plugin    [▶ Run] [✕] │  │
│  │    Deploy to staging environment          │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌─ Project Skills ─────────────────────────┐   │
│  │ 📦 DB Migrate      command   [▶ Run] [✕] │   │
│  │    Run database migrations                │   │
│  └───────────────────────────────────────────┘   │
│                                                 │
│  [+ New Skill]                                  │
│                                                 │
└─────────────────────────────────────────────────┘
```

SkillCard 组件：

```typescript
// components/skills/SkillCard.tsx
interface SkillCardProps {
  skill: SkillManifest;
  scope: SkillScope | "builtin";
  onRun: (skill: SkillManifest) => void;
  onEdit?: (skill: SkillManifest) => void;
  onRemove?: (skillId: string, scope: SkillScope) => void;
}
```

#### 3.3.2 TitleBar — Skill 快速执行下拉

在 Agent Selector 旁新增 Skill Selector：

- 显示当前项目可用的 skill 列表
- 按 scope 分组（Built-in / Global / Project）
- 点击直接执行（command 类型）或弹出参数输入对话框
- 无 project 选中时禁用

#### 3.3.3 项目侧边栏 — Skill 入口

在项目右键菜单中添加 "Skills..." 选项，点击打开 Settings Panel 并自动切换到 Skills tab。

### 3.4 SkillEditor — 创建/编辑表单

```typescript
// components/skills/SkillEditor.tsx
interface SkillEditorProps {
  manifest?: SkillManifest;       // undefined = 新建模式
  onSave: (manifest: SkillManifest, scope: SkillScope) => void;
  onCancel: () => void;
}
```

表单字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ID | text (auto) | - | 自动生成：name 转小写+连字符 |
| Name | text | ✓ | 显示名称 |
| Description | textarea | ✓ | 功能描述 |
| Version | text | ✓ | 默认 "1.0.0" |
| Type | select | ✓ | command / workflow / plugin |
| Tags | tag input | - | 回车添加标签 |
| Scope | radio | ✓ | global / project |
| Command / Steps / Entry | 根据 type 动态显示 | ✓ | 命令或步骤编辑器 |
| Args | dynamic list | - | 参数定义 |
| Shortcut | text | - | 建议快捷键 |

### 3.5 SkillExecuteDialog — 执行弹窗

```typescript
// components/skills/SkillExecuteDialog.tsx
interface SkillExecuteDialogProps {
  skill: SkillManifest;
  onExecute: (command: string) => void;   // 最终执行的命令
  onCancel: () => void;
}
```

执行流程：

```
用户点击 "Run"
    │
    ▼
skill 有 args? ──No──▶ 直接执行
    │
   Yes
    ▼
弹出 SkillExecuteDialog
用户填写参数值
    │
    ▼
模板变量替换: ${arg_name} → 用户输入值
    │
    ▼
command 类型: sendToTerminal(projectId, resolved_command + "\r")
workflow 类型: 逐 step 确认+执行
plugin 类型: 读取脚本内容后 sendToTerminal
```

---

## 4. 执行机制

### 4.1 Command 类型执行

复用现有 agent launch 机制，直接将命令发送到项目终端：

```typescript
const executeCommand = (projectId: string, command: string) => {
  // 发送 Ctrl+C 中断当前进程
  // 延迟 50ms
  // 发送 command + "\r"
  sendToTerminal(projectId, "\x03");
  setTimeout(() => sendToTerminal(projectId, command + "\r"), 50);
};
```

### 4.2 Workflow 类型执行

逐步骤执行，每步之间等待用户确认（除非 `confirm: false`）：

```typescript
const executeWorkflow = async (projectId: string, steps: WorkflowStep[]) => {
  for (const step of steps) {
    if (step.confirm) {
      const ok = await showConfirmDialog(`Run step: ${step.name}?\n$ ${step.command}`);
      if (!ok) return;
    }
    sendToTerminal(projectId, step.command + "\r");
    // 等待终端 idle 或超时
    await waitForTerminalIdle(projectId, 30000);
  }
};
```

### 4.3 Plugin 类型执行

通过后端读取脚本内容，发送到终端执行：

```typescript
const executePlugin = async (projectId: string, skillId: string, scope: SkillScope, projectPath: string | null) => {
  const scriptContent = await invoke<string>("read_skill_plugin", {
    skillId, scope, projectPath,
  });
  // 将脚本内容通过 stdin 传入 shell
  sendToTerminal(projectId, `cat <<'__NEEKO_SKILL_EOF__' | bash\n${scriptContent}\n__NEEKO_SKILL_EOF__\n`);
};
```

---

## 5. 文件变更清单

### 5.1 后端（Rust）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/skill.rs` | **新增** | SkillManager：扫描、读取、安装、删除 skill |
| `src-tauri/src/state.rs` | 修改 | 新增 SkillType、SkillArg、WorkflowStep、SkillManifest 结构体 |
| `src-tauri/src/lib.rs` | 修改 | 注册 SkillManager 到 AppStateWrapper，注册 5 个 Tauri 命令 |

### 5.2 前端（TypeScript/React）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/types.ts` | 修改 | 新增 SkillType、SkillArg、WorkflowStep、SkillManifest 类型 |
| `src/hooks/useSkills.ts` | **新增** | Skill 状态管理 hook |
| `src/components/skills/index.ts` | **新增** | 统一导出 |
| `src/components/skills/SkillPanel.tsx` | **新增** | Settings 中 Skills tab 主面板 |
| `src/components/skills/SkillCard.tsx` | **新增** | 单个 skill 展示卡片 |
| `src/components/skills/SkillEditor.tsx` | **新增** | 创建/编辑 skill 表单 |
| `src/components/skills/SkillExecuteDialog.tsx` | **新增** | 执行参数输入/确认弹窗 |
| `src/components/SettingsPanel.tsx` | 修改 | 导航新增 Skills tab，渲染 SkillPanel |
| `src/components/layout/TitleBar.tsx` | 修改 | 新增 Skill Selector 下拉 |
| `src/App.tsx` | 修改 | 集成 useSkills hook |

### 5.3 新增样式

| 文件 | 说明 |
|------|------|
| `src/styles.css` | 新增 `.skill-panel`、`.skill-card`、`.skill-editor`、`.skill-execute-dialog` 样式 |

---

## 6. 实施顺序

| 阶段 | 内容 | 预计工作量 |
|------|------|-----------|
| **Phase 1** | 后端：state.rs 数据结构 + skill.rs SkillManager + lib.rs 命令注册 | 中 |
| **Phase 2** | 前端：types.ts 类型 + useSkills hook + SkillPanel tab | 中 |
| **Phase 3** | 前端：SkillCard + SkillEditor + SkillExecuteDialog | 大 |
| **Phase 4** | 前端：TitleBar Skill Selector + 侧边栏集成 | 小 |
| **Phase 5** | 内置 skill + 样式 + 端到端测试 | 中 |

---

## 7. 未来扩展方向

- **Skill 市场**：从远程仓库下载/分享 skill（类似 VSCode 扩展市场）
- **Skill 依赖**：skill 之间可以声明依赖关系
- **Skill 变量**：支持更多模板变量，如 `${project.path}`、`${git.currentBranch}`
- **条件执行**：step 支持 `when` 条件表达式
- **并行 workflow**：支持 `parallel: true` 并行执行多个 step
- **Skill 快捷键绑定**：将 `shortcut` 字段生效到全局快捷键系统
