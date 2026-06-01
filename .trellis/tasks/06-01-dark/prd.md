# PRD: 优化 dark 主题配色

## 问题

dark 主题 `bg-primary: #1a1b1e` 过暗 (L=0.011)，导��：
1. 5 级灰阶 bg-* 相邻对比度均 < 1.16:1，面板层级无法区分
2. `border-color #2f3035` vs bg-primary 对比仅 1.31:1，边框不可见
3. `text-secondary #888888` vs bg-primary 对比 4.86:1，仅刚好 AA
4. `text-muted #666666` vs bg-primary 对比 3.0:1，不及格
5. titlebar 从 `#000000` 开始，与 bg-primary 形成纯黑硬接缝

## 方案

抬亮 bg-primary 基座 ~3%，同时拉开灰阶阶梯间距。

## 改动文件

- `src/styles/theme.css` — dark 块 CSS 变量修改

## 改动内容

| Token | 当前 | 目标 |
|---|---|---|
| bg-primary | #1a1b1e | #1e1f22 |
| bg-secondary | #252528 | #25262a |
| bg-tertiary | #2d2e32 | #2e3036 |
| bg-hover | #37383d | #383a42 |
| bg-selected | #3f4045 | #444650 |
| bg-gradient-start | #1d1e22 | #1f2024 |
| border-color | #2f3035 | #35373c |
| text-secondary | #888888 | #9a9a9a |
| text-muted | #666666 | #787878 |
| titlebar-gradient-start | #000000 | #1a1b1e |

## 验证

- `pnpm lint && pnpm type-check && cargo check --manifest-path src-tauri/Cargo.toml`
