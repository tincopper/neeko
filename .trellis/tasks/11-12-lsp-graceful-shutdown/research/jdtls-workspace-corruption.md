# 现场证据：jdtls `exited unexpectedly` + `no response received`（2026-11-12）

本文件是 `prd.md` 的唯一事实来源。全部结论来自本机实测输出，不靠推测。

## 1. 症状（用户侧）

```
error jdtls exited unexpectedly | stderr: WARNING: Using incubator modules: jdk.incubator.vector
      11月 12, 2026 5:47:58 下午 org.apache.aries.spifly.BaseActivator log
      信息: Registered provider ch.qos.logback.classic.spi.LogbackServiceProvider ...
error LSP error: LSP initialization: no response received | server stderr: <同上>
```

同一段 stderr 被投影多次（`crash_message` + init 失败两条错误文案各带一次尾部）。
stderr 里**没有任何** Java 堆栈 —— 这就是误导性所在。

## 2. Neeko 侧进程事实（`~/.neeko/neeko.log:4191-4210`）

```
[LSP] Resolved java.home for jdtls: /opt/homebrew/Cellar/openjdk@21/21.0.12.1/.../Home
[LSP][installer] check binary=jdtls target=Discriminant(0) found=true
[LSP] Spawning server: language=java binary=["jdtls"] project=/Users/tomgs/workspaces/java_space/hodor
[Command] resolved 'jdtls' -> /opt/homebrew/bin/jdtls
> {"jsonrpc":"2.0","id":1,"method":"initialize", ...}
[JDTLS stderr] WARNING: Using incubator modules
[JDTLS stderr] 信息: Registered provider ... LogbackServiceProvider
（无后续；11 秒后重试一次，同样死在原地）
```

- jdtls 来自 Homebrew（`jdtls 1.61.0`），**不是** Neeko 自装的 `~/.neeko/bin/jdtls`
  （该目录为空，本次未走 `java_install.rs` 的下载脚本）。
- JDK 解析正确（openjdk@21），**排除 JDK 版本/`JAVA_HOME` 假设**。
- Neeko 未向 jdtls 传任何 argv：`server_command = ["jdtls"]`，`args = cmd[1..] = []`
  （`session/instance.rs:149-161`）。`-data` 完全由启动器自己决定。

## 3. workspace 定位（`data` 目录从哪来）

brew 的 `bin/jdtls` 是 Python 启动器（`/opt/homebrew/Cellar/jdtls/1.61.0/libexec/bin/jdtls.py`）：

```python
# jdtls.py:88-99
cwd_name = os.path.basename(os.getcwd())
jdtls_data_path = os.path.join(cachedir, "jdtls-" + sha1(cwd_name.encode()).hexdigest())
```

`sha1("hodor") == c6447b82fbb4b8e7dbcf2d28a4d7372f5dc32687`
→ `-data /Users/tomgs/Library/Caches/jdtls/jdtls-c6447b82...`

> key 只有 **basename**：任何叫 `hodor` 的工程共用同一个 workspace。
> 对照 Neeko 自装版的包装脚本（`plugin/builtins/java_install.rs:44`）用的是**全路径**
> （`$(echo "$PWD" | tr '/' '_')`）—— 两种安装路径的隔离语义不一致。

## 4. 真正的死因（`<data>/.metadata/.log`）

```
!SESSION 2026-11-12 17:47:58.428   Command-line arguments: -data .../jdtls-c6447b82...
!ENTRY org.eclipse.core.resources 2 10035 17:47:58.749
!MESSAGE The workspace exited with unsaved changes in the previous session;
         refreshing workspace to recover changes.
!ENTRY org.eclipse.osgi 4 0 17:47:58.864
!MESSAGE An error occurred while automatically activating bundle org.eclipse.core.resources (31).
    Exception in org.eclipse.core.resources.ResourcesPlugin.start()
    at ... SaveManager.restore(SaveManager.java:834)
    at ... Workspace.startup(Workspace.java:2677) → Workspace.open(Workspace.java:2369)
Caused by: org.eclipse.core.internal.dtree.ObjectNotFoundException:
    Tree element '/hodor-storage/hodor-storage-xfile/.settings/org.eclipse.m2e.core.prefs' not found.
→ BundleException: org.eclipse.jdt.core 起不来
    Caused by: java.lang.NoClassDefFoundError: org/eclipse/core/resources/IWorkspaceRunnable
→ BundleException: org.eclipse.jdt.ls.core 起不来
    Caused by: java.lang.NoClassDefFoundError: org/eclipse/jdt/core/WorkingCopyOwner
!MESSAGE Application error            ← Equinox 退出 → 进程死亡
```

链条：资源树快照里记录的文件在磁盘上已不存在 → `SaveManager.restore()` 抛异常 →
`ResourcesPlugin` 激活失败 → jdt.core / jdt.ls.core 连锁 `NoClassDefFoundError` →
`Application error` → JVM 在 LSP 握手之前退出。故 Neeko 侧只能观测到
「stderr 只有无害警告」+「initialize 无响应」。

## 5. 快照为什么会脏

| 事实 | 证据 |
| --- | --- |
| 上一次会话（16:28 起）**没有**优雅关闭 | 该 `.metadata/.log` 段内无任何 `>> shutdown` / `>> exit`；日志停在索引/hover 工作中 |
| 快照文件在被杀窗口内被写过 | `.metadata/.plugins/org.eclipse.core.resources/0.snap` mtime **17:34** |
| 下一轮启动即在同一秒内失败 | 17:47:47、17:47:58 两次 `!SESSION`，两次都是 `Application error` |
| 被记录的文件确实属于「易被 git 清掉」的一类 | `hodor/.gitignore:15` = `.settings`；`.settings/*.prefs` 现在虽在（16:28/16:34 mtime），但 `git clean -xdf` / 切分支即会抹掉 |

Eclipse 在 `SaveManager` 周期 checkpoint 与关闭 checkpoint 期间写 `0.snap`；
进程在该窗口被 SIGKILL → 快照内部不自洽（引用了树里已无的节点）。

## 6. Neeko 代码里的两条关闭路径（本次 bug 的落点）

`src-tauri/src/lsp/manager.rs`

| 路径 | 行 | 现状 | 判定 |
| --- | --- | --- | --- |
| `close_session_impl`（`close_session` / `close_session_for_restart`） | 861-877 | `send_shutdown_request()` 等响应 → 发 `exit` → **立即** `kill_child()` | 协议顺序对，但仍不等进程自行退出 → 仍可能截断 checkpoint |
| `close_sessions_for_project`（`schedule_deactivate` 30 分钟后触发） | 879-906 | `send_notification_raw("shutdown")` ← **notification，不是 request** → `sleep(10ms)` → `kill_child()` | 违反 LSP 规范，且必然硬杀 |

`DEFAULT_DEACTIVATE_STOP_SECS = 30 * 60`（manager.rs:37）：用户离开项目 30 分钟后才触发，
所以事故时间点（16:28 会话 → 17:34 被杀）与该路径吻合。

## 7. 为什么诊断不可见（次生问题）

- jdtls 的致命日志只进 `<data>/.metadata/.log`，不进 stderr。
- Neeko 的崩溃文案唯一构造点 `session/lifecycle.rs:163` 只投影 stderr 尾部 →
  `exited unexpectedly | stderr: WARNING: Using incubator modules` 对定位零帮助。
- Neeko 不拥有 `<data>` 路径（由启动器决定），所以现在也无法读那份日志。

## 8. 立即恢复手段（已验证可用的手工修复）

```bash
pkill -f jdtls
rm -rf ~/Library/Caches/jdtls/jdtls-c6447b82fbb4b8e7dbcf2d28a4d7372f5dc32687
```

纯缓存目录，删掉只损失索引（重建代价 = 重新 import Maven 工程）。
