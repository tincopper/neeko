/**
 * 语言 → 模块的**唯一清单**。
 *
 * `Record<RunLang, LanguageModule>` 的键类型在编译期强制穷尽：新增一门语言必须
 * （1）加 `RunLang` 联合成员、（2）建 `languages/<lang>/index.ts`、（3）在 `RUNNERS` 补一行 ——
 * 漏任何一步都编译失败。这是方案 B「新增语言只碰语言目录 + 一行注册」的落点，
 * 也取代了此前需要同步维护的两张表（`utils/runLanguages` 声明表 + `exec/registry` 前置表）。
 *
 * 架构护栏（`__tests__/architecture.test.ts`）钉住本文件是全仓**唯一**出现
 * `Record<RunLang, LanguageModule>` 的地方。
 */
import type { RunLang } from '../syntax/contract';

import type { LanguageModule } from './contract';
import { GO } from './go';
import { JAVA } from './java';
import { RUST } from './rust';
import { TS } from './ts';

const RUNNERS: Record<RunLang, LanguageModule> = {
  ts: TS,
  rust: RUST,
  go: GO,
  java: JAVA,
};

/** 按语言 id 查表（键穷尽 → 恒有值）。 */
export function runnerFor(lang: RunLang): LanguageModule {
  return RUNNERS[lang];
}

/** 全部语言模块（按声明序：查找序即优先级）。 */
export function allRunners(): readonly LanguageModule[] {
  return Object.values(RUNNERS);
}

/**
 * DAP 配置 `type` → 语言模块（配置驱动的调试路径用）。
 *
 * DAP 的 `type` 是适配器标识（`java` / `go` / `lldb`），不是 `RunLang`（`lldb` 服务 Rust），
 * 故需要一张小映射表。**未登记的 type**（用户自定义适配器）返回 `null` → 调用方走通用兜底文案。
 */
const ADAPTER_TYPES: Readonly<Record<string, RunLang>> = {
  java: 'java',
  go: 'go',
  lldb: 'rust',
  codelldb: 'rust',
};

export function adapterHookFor(configType: string): LanguageModule | null {
  const lang = ADAPTER_TYPES[configType];
  return lang ? RUNNERS[lang] : null;
}
