# 现状盘点：门禁的四个声明面（2026-10-08，commit eba3c7b0）

本文件是「改造前」的实测快照。设计里所有「不得漂移」的断言都对照本表。
数据来源：`package.json` / `lefthook.yml` / `.github/workflows/ci.yml` /
`.github/BRANCH_PROTECTION.md` / `tools/guards/**`（逐行读，非推断）。

## 1. 判据层：已完成（本次不动）

- `tools/guards/checks/` = 注册表，15 个模块。新增一条护栏 = 放模块 + 配套
  `tests/test_<id>.py`，`package.json` / `lefthook.yml` / `ci.yml` 一行不改。
- 契约在 `core/contract.py`：`EXIT_OK=0 / EXIT_VIOLATION=1 / EXIT_GUARD_ERROR=2`、
  `GuardResult`（`scanned` 必填，反空转）、`Guard`（id/title/scopes/stages/
  red_lines/docs/ledger/fix_hint/budget_ms）。
- 调度在 `core/runner.py`：stage 选择、scope 增量跳过、超时→ERROR、异常→ERROR、
  `scanned<=0`→ERROR。
- 三个消费端各调用一次：`package.json` 的 `guards` 脚本、`lefthook.yml` 的
  `guards:` 命令、`ci.yml` 的 `Run repository guards`。

### 1.1 一个关键实测事实（本次改动的高爆半径点）

```bash
grep -rn "stages" tools/guards/checks/*.py   # → 0 命中
```

**15 条护栏全部依赖 `contract.ALL_STAGES` 默认值**（当前 = `("local","ci","commit")`），
没有一条显式声明 `stages=`。因此 `ALL_STAGES` 是「所有护栏的 stage 集合」的
事实单点：把 `push`/`manual` 加进 `ALL_STAGES` 会让 15 条护栏全部多跑两个上下文。
设计里必须把它拆成「词汇表」与「默认值」两个概念。

## 2. 编排层：仍然是 `&&` 链 + 四处手抄

### 2.1 `package.json`（10 处 `&&`）

```jsonc
"build":        "tsc --noEmit && vite build",
"lint":         "pnpm lint:fe && pnpm lint:rust && pnpm guards run --stage local",
"lint:fe":      "eslint src/ --cache && pnpm type-check",
"lint:fix":     "cargo fmt ... && eslint src/ --cache --fix",
"lint:rust":    "cargo fmt ... --check && cargo clippy ... -D warnings",
"test":         "pnpm test:fe && pnpm test:rust && pnpm test:host",
"test:coverage":"pnpm test:fe:coverage && pnpm test:rust:coverage",
"check:fe":     "pnpm lint:fe && pnpm test:fe",      // 全仓零引用（孤儿脚本）
"check:rust":   "pnpm lint:rust && pnpm test:rust",  // 全仓零引用（孤儿脚本）
"check":        "pnpm lint && pnpm test",
```

### 2.2 `lefthook.yml`（6 条命令 + 9 条手写 glob）

| hook | command | glob | run |
|---|---|---|---|
| pre-commit | lint-frontend | `src/*.{ts,tsx,js,jsx}`、`src/**/*.{ts,tsx,js,jsx}`、`package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`.eslintrc.cjs`、`.prettierrc` | `pnpm lint:fe` |
| pre-commit | lint-rust | `src-tauri/*.rs`、`src-tauri/**/*.rs`、`src-tauri/Cargo.toml`、`Cargo.lock`、`build.rs` | `pnpm lint:rust` |
| pre-commit | guards | 无（每次都跑） | `python3 tools/guards/run.py run --stage commit --staged` |
| commit-msg | commitlint | — | `pnpm commitlint --edit {1}` |
| pre-push | frontend-tests | `src/*.{ts,tsx,js,jsx}`、`src/**/*.{ts,tsx,js,jsx}`、`package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts` | `pnpm test:fe` |
| pre-push | rust-tests | 同 lint-rust 的 glob | `pnpm test:rust` |
| pre-push | host-tests | `tools/java-host/**` | `pnpm test:host` |

三个 pre-push 命令 `parallel: true` ⇒ 墙钟 ≈ max(前端 50s, Rust 3min, host) ≈ 3min。
**收成一条框架命令时若不引入并发，墙钟会退化成三者相加 ≈ 4min+** —— 这是本次
必须一并解决的派生需求（见 design 的 `--jobs`）。

### 2.3 `.github/workflows/ci.yml`（7 个 job，命令与 gate 指纹）

| job | 关键 run | 备注 |
|---|---|---|
| frontend-check | `pnpm lint:fe` | 单平台 |
| frontend-test | `pnpm test:fe:coverage` | 含覆盖地板（`vitest.config.ts`） |
| frontend-build | `pnpm build` | 生产打包 |
| java-host-check | `pnpm build:host` | `build.sh` 第 3 步即 `test.sh` |
| backend-check | `cargo check`、`pnpm lint:rust`、`python3 tools/guards/run.py run --stage ci --format github-actions` | 3 平台 matrix |
| backend-test | `pnpm test:rust` | 3 平台 matrix |
| backend-coverage | `pnpm test:rust:coverage` | 含 `Detect Rust changes` 前置步骤 |

注意：`cargo check` 是**裸命令**（没有 pnpm wrapper），拓扑校验必须支持非 pnpm 形态。

### 2.4 `.github/BRANCH_PROTECTION.md`（手抄的 required checks）

```
frontend-check / frontend-test / frontend-build
backend-check (ubuntu|macos|windows)
backend-test  (ubuntu|macos|windows)
backend-coverage / java-host-check
```

与 2.3 的 7 个 job 目前一致（但一致是巧合性维护的结果，没有任何东西保证它）。

## 3. 已实测的漂移事故（本次改动的动机证据）

1. `check_font_family_guard` / `check_codemirror_singleton` 曾只挂在本地 `lint`，
   CI 不调用 `pnpm lint` ⇒ 对 PR 零约束力（`core/registry.py` 模块头记载）。
2. `BRANCH_PROTECTION.md` 的清单曾漏 `java-host-check` / `frontend-build`，而
   「效果」段照称已覆盖（该文件自身的尾注记载）。
3. 根 `AGENTS.md` 把这类失效写成了规则：纳入 `packages/` 门禁需同时改
   根脚本 + CI job + lefthook glob + BRANCH_PROTECTION，**只改一处会得到一条
   看起来存在、实际不触发的门**。这条规则至今靠人记。

## 4. 技术约束（实测）

| 约束 | 证据 |
|---|---|
| 护栏框架**只能用标准库** | `python3 -c "import yaml"` → `ModuleNotFoundError`；`core/**` 只 import `argparse/importlib/inspect/json/pathlib/re/subprocess/sys/time/traceback/unittest/dataclasses` |
| lefthook 2.1.10 提供 `{push_files}` 与 `{staged_files}` | 二进制内字符串 `{push_files}`、`{staged_files}`；README 示例 `yarn eslint {staged_files}` |
| `core.repo` 的 glob 引擎**不支持 `{a,b}` 花括号** | `_glob_to_regex` 只处理 `*` `**` `?` 与转义；因此 gates 的 scope 必须写成展开形态 |
| `core.repo` 的目录型 scope 自动展开为「自身 + `/**`」 | `_expand()`：无通配符的 scope 展开成 base 与 base/** |
| 夹具不得硬编码绝对路径（红线 13） | `tests/support.py` 一律 `tempdir()` 派生；外部命令夹具须用 `sys.executable` |

## 5. 相关文档与台账（改动必须同步的落点）

- `CONTRIBUTING.md`：`Quality Gates` 表（hook 一览）、`Adding a guard`、`Adding an invariant`。
- `AGENTS.md`：`Development Commands` 段（`pnpm lint` / `pnpm check` 的组成描述）、
  `packages/` 门禁豁免段（「只改一处」规则）、红线索引表（本次不应触碰红线表本身，
  否则要同步 `ledger/agents_md_routing.json`）。
- `tools/guards/ledger/invariants.json`：新增不变量必须登记（`check_invariant_enforcement` 校验）。
- `tools/guards/checks/check_script_references.py`：扫描实时面里的 `pnpm <name>`，
  本次新增/删除脚本名必须在同一 diff 内同步所有调用点。
- `tools/guards/ledger/gates.json`（新增）：gate 声明本体。
