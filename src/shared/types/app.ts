/**
 * 应用版本/元数据信息 —— 与后端 `src-tauri/src/about/services.rs` 的
 * `AppInfo`（serde camelCase）一一对应。
 */
export interface AppInfo {
  /** 应用名称（如 "Neeko"）。 */
  name: string;
  /** 应用版本号（语义化版本，如 "1.0.6"）。 */
  version: string;
  /** 应用包标识符（如 "com.neeko.desktop"）。 */
  identifier: string;
  /** 应用描述。 */
  description: string | null;
  /** 作者字符串。 */
  authors: string | null;
  /** 许可证（SPDX 标识，如 "Apache-2.0"）。 */
  license: string;
  /** Tauri 框架版本。 */
  tauriVersion: string;
  /** 操作系统名称（macos / linux / windows）。 */
  os: string;
  /** CPU 架构（aarch64 / x86_64 …）。 */
  arch: string;
  /** 版权声明。 */
  copyright: string | null;
}
