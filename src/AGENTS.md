# Neeko 前端（`src/`）开发规则

> **根文件硬指令：改 `src/**` 前必须读本文件**（工具不会总是自动注入）。跨栈规则在仓库根
> `AGENTS.md`（红线表列出各自落点）；后端规则在 `src-tauri/AGENTS.md`。红线编号与根文件
> 索引一一对应。细则与样例在 `.trellis/spec/frontend/`，本文只保留祈使句与判据。

## 模块布局

Feature-Based 架构，`src/` 顶层：

- `app/` —— 组合入口：`App.tsx`（hooks + JSX 编排）、`main.tsx`、`AppModals/AppProviders`、
  `hooks/useAppShell.ts`（主协调）、`components/`、`dock/`
- `features/` —— 按域拆分的功能模块，每个域自带 `components/ hooks/ store/`。域清单以
  `ls src/features` 为准 —— **不在本文档维护副本**
- `shared/` —— 跨域共享：组件、hooks、zustand `store/`、`types/`（按域分文件）、`utils/` 等
  （子目录清单以 `ls src/shared` 为准）
- `layout/` `lib/` `ui/` `styles/` `testing/`

完整树状与职责：`docs/project-frontend-struct-spec.md`、
`.trellis/spec/frontend/directory-structure.md`、`docs/neeko-development-spec.md`。

## 主链路

`main.tsx` 挂载 → `App.tsx` 组合层调用 `useAppShell` → 初始化期显示 `SplashScreen`，正常期挂载
`TitleBar`、`AppLayout`、`AppModals`、`AppToast`。状态协同：`useAppShell`（组合入口）+
`shared/store/`（zustand 全局）+ `shared/types/`（类型）。

数据流：UI 交互 → hooks → `@tauri-apps/api/core` 的 `invoke` → Rust 命令经 `State<AppStateWrapper>`
访问 manager → 结果回传并更新 store。

## 前端架构约定

1. **类型管理**：共享接口定义在 `src/shared/types/`，按域分文件；组件内不重复定义
2. **Hook 设计**：各 feature 域管理自己的 hooks；共享 hooks 在 `src/shared/hooks/`；跨域协调在
   `useAppShell` 层组合
3. **Ref 同步集中**：所有 refs 在单个 effect 中同步
4. **功能域代码**放在 `src/features/` 对应子目录
5. 页面容器逻辑下沉到 hooks，`App.tsx` 维持组合层职责；改动优先落在 `useAppShell` 或 domain
   hook，不把业务逻辑回填到 `App.tsx`，改完更新类型并跑 `pnpm type-check`

### React 性能优化

| 模式 | 规则 |
| --- | --- |
| `React.memo` | 列表项组件、大型布局组件、复用组件 |
| `useMemo` | 昂贵计算（`buildTree`、字体列表、分支过滤） |
| `useCallback` | 跨组件回调、hooks 返回的函数 |
| 内联对象 | 避免 JSX 中 `style={{...}}` 常量对象，提取到模块级 |
| 条件渲染 | 用三元而非 `&&`（避免 falsy 值渲染） |
| Ref 模式 | 频繁变化的值用 ref 跟踪，在 effect 中同步 |

### 状态管理原则

1. **就近管理**：状态放在最近的共同祖先。局部状态 `useState`，feature 域状态 feature store，全局状态 `shared/store`
2. **禁止冗余状态**：能派生计算的状态不单独存储（用 `useMemo` 替代）
3. **单向数据流**：数据自上而下流动，事件自下向上传递，禁止子组件直接修改父组件状态

## 模块导入/导出规范（Import/Export Firewall）

> 遵循业界主流（Meta/Google 反对 barrel），明确「什么走门面、什么直导」。

1. **禁止全局 barrel**：严禁 `@/components/index.ts`、`@/stores/index.ts` 之类的根级聚合导出 ——
   破坏 tree-shaking、引发循环依赖。
2. **store 目录化直导**：跨 feature 使用 store 一律直接导入具体文件（如
   `import { useFileStore } from '@/features/file/store'`），禁止经 feature `index.ts` re-export store。
   zustand store 是 feature 的公开状态接口，不是门面内容。**store 文件统一放在 `store/` 目录（或根级
   `store.ts`）**，与防火墙白名单（`./store` / `./store.ts`）对齐 —— 这是「约定式公开面」：跨 feature
   能直导的只有 `store/`、`types/`、`api/`，其余路径一律视为内部实现。禁止把 store 散落在 feature
   根级命名（如 `quickOpenStore.ts`），否则直导会被防火墙拦截、又只能退回门面导入，陷入规范自相矛盾。
3. **类型直导或豁免**：`export type` 编译期擦除、无 tree-shaking 影响；共享类型统一放
   `src/shared/types/`，feature 内类型就近定义并直接导入。
4. **feature `index.ts` 仅为门面**：只允许 re-export 公开组件与公开 hooks（如 `FilesPanel`、
   `useLocateFileInTree`），用作对外防火墙；禁止把 store、内部工具函数纳入。
5. **同 feature 内部禁止自环门面**：同一 feature 内模块之间直接导入具体文件，不得通过本目录
   `index.ts` 互相引用。

## 审查红线（前端专属）

> 违反即为 Block 级。跨栈红线不在此列 —— 落点见根 `AGENTS.md` 红线表的「全文位置」列。

**12. 路径身份唯一化（Single Path Identity）** —— 所有「这是不是同一个文件」的判定必须落在 `FileRef`
身份上（`src/shared/utils/fileRef.ts`：`sameFile` / `sameIdentity` / `pathsContainFile` /
`sourceIdentityOf`），**禁止消费侧自造字符串归一或别名匹配**（裸路径等值、`endsWith('/' + p)`、
`` `${root}/${rel}` `` 拼接）。

同一份源码出现两种表示会让断点 key 分叉、黄线与光标各认一个、变更事件漏配导致视图不刷新（issue #13）。

展示 / URL / 树结构 / 命令入参派生的归一是合法的，但**出现点必须登记分类**：护栏
`.trellis/scripts/check_path_identity_scope.py`（已接 `pnpm lint` 与 CI）以 `MANIFEST` 为机读台账，
未登记命中 / 登记失效 / 计数漂移 / 扫描集为空四种情况均判失败；**改代码前先跑 `--list` 看全量台账**。
细则见 `.trellis/spec/frontend/state-management.md`。

## 测试

Vitest + `@testing-library/react` + jsdom。目录约定：`src/testing/`（`setup.ts` 全局 setup、
`factories.ts` 工厂）、`src/features/*/__tests__/`、`src/shared/hooks/__tests__/`、
`src/shared/utils/__tests__/`。

前端测试层级与 mock 策略（组件级一律 mock `invoke`）见 `.trellis/spec/unit-test/frontend-testing.md`、
`mock-strategies.md`；覆盖率基线与测试硬约束（合入门槛、独立性、耗时上限）见根 `AGENTS.md`「TDD 开发模式」。
