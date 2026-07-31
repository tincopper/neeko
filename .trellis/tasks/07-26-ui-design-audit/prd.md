# UI 设计审计与优化方案

## 目标

对 Neeko（统一管理多 AI CLI Agent 的专业 IDE 工具）做整体 UI 设计审计，输出问题清单与分阶段优化方案。  
**本任务只产出规划文档，不直接改代码。**

## 产品定位（约束）

- 产品定位：跨平台桌面 **专业 IDE 工具**，统一管理多 AI CLI Agent（本地 / WSL / SSH）
- 参考体验：Cursor / VS Code / Zed / JetBrains 的密度、层级、键盘优先、chrome 克制
- 技术现状：React 18 + Tailwind v4 + shadcn/ui + Islands Dock 布局 + 多主题 CSS 变量
- 约束：不破坏现有 dock / terminal / editor 工作流；优化需可分阶段落地

## 需求

1. 完成信息架构（IA）与布局地图梳理
2. 完成设计系统盘点：主题 token、spacing/radius、组件原语、使用一致性
3. 输出按 P0/P1/P2 分级的 UI/UX 问题清单（附文件证据）
4. 输出面向专业 IDE 的现代化优化方案（原则 + token + 组件规范 + 分阶段落地）
5. 明确应保留的优势，避免推倒重来
6. 沉淀 `design.md` 与 `implement.md`，供后续实现任务拆分

## 不在范围内

- 直接修改业务代码 / 样式实现
- 后端协议、Agent 运行时逻辑
- 全新视觉品牌重设计（logo / 营销站）

## 验收标准

- [x] 产出当前 UI 布局与 IA 地图
- [x] 产出设计系统一致性问题（含量化证据，含复测命令 design §8.1）
- [x] 产出 P0/P1/P2 问题清单（含路径证据）
- [x] 产出分阶段优化方案与验收标准（A–F ↔ 子任务映射 design §10.2）
- [x] 明确后续可拆分的实现子任务建议（8 个子任务 + 依赖图 + v1 cut，design §10）
- [x] 开放决策给默认推荐（Decision Log D1–D5，design §11）
- [x] 原型资产化索引（design §12，5 份任务内原型）
- [x] 跨任务边界声明（vs unified-task-hub，design §13）
- [ ] 用户确认方案优先级与 Decision Log 后，再拆实现任务并 `task.py start`

## 备注

- 本任务为 **complex planning**：需要 `prd.md` + `design.md` + `implement.md`
- 实现阶段按 design.md §10.1 拆子任务（tokens / primitives+chrome / theme-escape / empty-loading / settings-ia / skills-ia / nav-cleanup / quality-gate）
- 决策待确认项：D1 Skills IA（推荐 master-detail）、D2 Settings 形态、D3 DockZoneTabs、D4 Apple tokens、D5 语义色双写
