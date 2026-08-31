# 字体选择器优化：macOS 目录扫描 + 缓存（Windows 留观）

## Background

用户反馈字体列表加载慢（macOS 10s+）与字体预览不生效。

## 根因（实测取证）

1. macOS 用 `system_profiler SPFontsDataType -json` 枚举：实测 10 秒+/2MB JSON，
   同步调用阻塞 IPC；前端每次进设置页重拉。
2. 预览"不生效"体感：system_profiler 的 family 列表混入 `.` 前缀系统私有字体
   （选中后 CSS 无法命中 → 回退默认栈 → 界面无变化）；且用户机器未安装
   JetBrains Mono 等默认栈字体，任何回退都让预览/终端"看起来没变"。

## Implemented（2026-08-31）

- **macOS**：`system_profiler` → 直接扫描标准字体目录
  （~/Library/Fonts → /Library/Fonts → /System/Library/Fonts），毫秒级；
  文件名启发式推断 family（去 -Regular/-Bold 等样式后缀、_→空格）。
- **三平台统一**：进程级缓存（枚举一次/生命周期）+ `.` 私有字体
  过滤（三平台生效）+ `get_system_fonts` 命令改 async spawn_blocking（pillar 7）。
- 测试：Rust 4 用例（私有过滤/文件名启发式/真实目录扫描断言/缓存链路）。

## Final Implementation — Post-Review Fixes（2026-08-31）

- **缓存可刷新**：`OnceLock` → `Mutex<Option<Vec>>`，枚举在锁外执行规避 Pillar 6 锁饥饿；
  新增 `reset_font_cache` / `reset_font_cache` Tauri 命令 + 前端 `⟳` 刷新按钮（设置页字体下拉），
  安装新字体后无需重启。测试新增 `reset_font_cache_rebuilds_on_next_call`（5 用例）。
- **连体后缀修复**：`style_suffixes` 按长度降序排序，`-BoldItalic` 先于 `-Bold`/`-Italic` 命中，
  避免 `Foo-BoldItalic` 被截成 `Foo-Italic`；补单测 `SourceCodePro-BoldItalic → SourceCodePro`。
- **字体栈 SSOT 统一**：`typography.ts` 为唯一真相，`terminal.ts` 保留 re-export 兼容；
  打包 JetBrains Mono @font-face（OFL，随应用分发）作首位默认 + Menlo 兜底，杜绝回退链漂移；
  终端/编辑器行高分离（1.2/1.5）并随字号动态派生，`syncTypographyTokens` 修复全局泄漏。
- **守卫豁免**：`check_font_family_guard.py` 豁免 `jetbrains-mono.css`（与 `nerd-font.css` 同类 @font-face 定义源）。
- **交付**：`5ec020be perf(font): accelerate picker and unify typography SSOT`（30 files）。

## Windows 留观决策（选项 B）

Windows 现状：PowerShell + GDI+，首次 1–3s（OnceLock 已压缩到一次）。
可优化为注册表直读（毫秒级），但：
1. 注册表值名为文件形态，需复用启发式转换；
2. 本机无 Windows 真机，注册表值形态/HKCU 分支无法验证——
   「一次性交出三平台适配代码」的实质是交付验证过的代码。

**触发条件**：Windows 真机可用时，改注册表直读
（HKLM + HKCU \SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts），
复用 `family_from_filename` 启发式，删 PowerShell 路径。
