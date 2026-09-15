/**
 * Java 的 IO 出口（**本文件是本语言唯一的 IO 边界**）。
 *
 * 与 `languages/io.ts`（通用 IO 面：文件/构建/通知/确认/LSP 请求/目标平台）分开的原因：
 * 下面三个动作**只服务 Java 调试**（java-debug bundle 供给、Java 语言服务器重启、Java 后端配置）。
 * 放进通用面会让 `io.ts` 随语言数量单调膨胀成「新语言就往这里塞」的垃圾场 ——
 * 架构护栏 6 因此把豁免改为**按语言粒度**（`languages/io.ts` + `languages/<lang>/io.ts`）。
 *
 * 语言模块内部据此收拢「谁需要触达外部系统」的事实，通用层与本语言的行为边界保持清晰。
 */
import { ensureJavaDebugBundle, lspRestartSession } from '@/features/lsp/api/lspApi';
import { loadJavaDebugBackend } from '@/features/settings/api/settingsApi';

export const javaIo = {
  /** 下载并安装 java-debug 插件（JDTLS 后端的一次性供给）。 */
  ensureDebugBundle: () => ensureJavaDebugBundle(),
  /** 重启 Java 语言服务器（安装 bundle 后让其重新注册命令）。 */
  restartLspSession: (projectPath: string) => lspRestartSession(projectPath, 'java'),
  /** 读取 `dap.javaBackend` 配置（JDTLS / host / auto 的判据）。 */
  readDebugBackend: () => loadJavaDebugBackend(),
};
