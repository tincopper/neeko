# 补全 UI 优化方案（基于 prototype-autocomplete.html）

> 基准原型：`.trellis/tasks/08-05-intellisense-component-redesign/prototype-autocomplete.html`
> 审查对象：`completionRenderer.ts` / `lspCompletionInfoRenderer.ts` / `completionTheme.ts` / `src/styles/index.css`（补全段）

## 一、原型要点（对齐基准）

| 区域 | 原型规格 |
| --- | --- |
| 列表项 | 两行：图标 + label + detail（右对齐）｜第二行模块路径 muted |
| 图标 | 16px 圆角方块 + 字母字形（ƒ/v/m…），按类型分色 |
| 选中态 | `--bg-hover` 背景 + 左侧 2px accent 蓝边框 |
| Info 面板 | 签名头（fn-name 紫 / param 橙 / type 蓝）→ 文档 → Parameters 表（Name/Type/Description）→ Returns（绿色 type） |
| 容器 | `--bg-secondary` + 1px border + 11px 圆角 + 双层阴影 + fadeIn 180ms |

## 二、现状差距分析

| # | 维度 | 原型 | 当前实现 | 差距 |
| --- | --- | --- | --- | --- |
| G1 | 签名头着色 | fn-name 紫 / param 橙 / type 蓝 | `buildInfoPanel` 用 `textContent` 单色（`.cm-lsp-info-signature` text-secondary） | **最大视觉差距** |
| G2 | Parameters 段标题 | 表上方 "Parameters" 小标题 | `buildParamsTable` 无标题，表直接贴文档 | 信息层级缺失 |
| G3 | Returns 高亮 | label + 绿色 type | `Returns: ${returns}` 单色 text-secondary | 无绿色 type |
| G4 | 模块路径来源 | `dispatch_test.go:42` / `github.com/…/dispatch` 完整路径 | 正则 `\(([a-z][\w/.]+)\.` 只抓 Go 包片段；未用 `item.data.URI` | 信息量不足 |
| G5 | 图标语言 | variable=v 绿 / method=m 浅蓝 / class=C 紫 | variable=● 绿、method=ƒ 蓝、class=◈ 橙 | 字形与原型不一致 |
| G6 | 列表 detail 前缀 | `func(t *testing.T)` | `buildListItem` 剥 `func(` → `(t *testing.T)` | 细节差异 |
| G7 | 动画/尺寸 | 180ms / 列表 420px | 150ms / min-width 280px | 次要 |
| G8 | 模块行缩进 | 与 label 同起点（flex 布局） | `padding-left: 18px` 近似 | 需实机核验 |

## 三、分阶段方案（每阶段先写测试，Red-Green-Refactor）

### Phase 1 — Info 面板信息层级（P0，对齐 G1/G2/G3）

1. 新增纯函数 `highlightSignature(funcName, detail)`：复用 `parseSignatureDetail` 结果，把
   函数名 / 参数名 / 参数类型包成 `<span class="cm-lsp-sig-fn-name">`（紫）/
   `.cm-lsp-sig-param`（橙）/ `.cm-lsp-sig-type`（蓝）；`buildInfoPanel` 改用 `innerHTML` 注入。
2. `buildParamsTable` 前插入 `.cm-lsp-info-params-title`「Parameters」标题（10px uppercase muted，
   对齐原型 `.info-params-title`）。
3. Returns 改为「label + 绿色 type」两段结构（`.cm-lsp-info-returns-label` + `.cm-lsp-info-returns-type`）。
4. `completionTheme.ts` / `index.css` 补齐上述样式类。
- 测试：`completionRenderer.test.ts` 新增 highlightSignature 用例（Go/Rust/箭头/无参/空 detail）。

### Phase 2 — 模块路径真实化（P1，对齐 G4）

1. 新增 `extractModulePath(item)`：
   - 优先 `item.data?.URI`（gopls 等服务器在 data 中携带源文件 URI，解析为相对项目路径 `dir/file.go`）；
   - 兜底现有 detail 包路径启发式；
   - 再兜底 label 点路径。
2. `buildModuleNodeFromCompletion` 改收完整 item（含 `data`），第二行展示 `event/dispatcher/dispatch.go` 风格。
- 测试：有 data.URI / 无 data / 无 detail / 边界。

### Phase 3 — 图标语言统一（P1，对齐 G5）

| type | 字形 | 底色 |
| --- | --- | --- |
| function | ƒ | `--accent-blue` |
| method | m | `#79c0ff`（与 function 区分） |
| variable/property/field | v | `--accent-green` |
| class/interface | C | `--accent-purple` |
| constructor | C | `--accent-purple` |
| constant | ◆ | `--accent-yellow` |

图标规格对齐原型：16px、圆角 4px、字形 10px 粗体。
- 测试：`completionTheme.test.ts` 断言 ::before 内容与底色。

### Phase 4 — 细节对齐（P2，对齐 G6/G7/G8）

1. 列表 detail 保留 `func(...)` 前缀（移除 `buildListItem` 中的剥除，仅 info 面板继续清理）。
2. 下拉动画 150 → 180ms；列表 `min-width` 280 → 360px；滚动条 6px/3px 统一。
3. 实机核验模块行缩进与原型一致性。

### Phase 5 — 回归

- `pnpm type-check` / `pnpm test:run` / `pnpm lint:fe`
- 补全相关测试全绿后，由用户 review 视觉一致性（对应 PRD 验收项）。

## 四、不在范围

- 不替换 CM6 列表渲染引擎；不改 LSP 协议层；不引入新依赖。
