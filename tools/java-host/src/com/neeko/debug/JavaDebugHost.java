package com.neeko.debug;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.logging.Level;
import java.util.logging.Logger;

import com.microsoft.java.debug.core.adapter.ICompletionsProvider;
import com.microsoft.java.debug.core.adapter.IEvaluationProvider;
import com.microsoft.java.debug.core.adapter.IHotCodeReplaceProvider;
import com.microsoft.java.debug.core.adapter.IProviderContext;
import com.microsoft.java.debug.core.adapter.ISourceLookUpProvider;
import com.microsoft.java.debug.core.adapter.IVirtualMachineManagerProvider;
import com.microsoft.java.debug.core.adapter.ProtocolServer;
import com.microsoft.java.debug.core.adapter.ProviderContext;

/**
 * Neeko Java Debug host —— 自写 DAP 服务器 main，托管
 * {@code com.microsoft.java.debug.core}（JDT-free 纯库，见
 * .trellis/tasks/09-04-editor-test-run-buttons/research/java-debug-runability.md §1.3）。
 *
 * <p>复刻 microsoft/java-debug {@code JavaDebugServer} 的形态：
 * <pre>
 *   ServerSocket(0)                  // 随机端口
 *     └─ accept 循环                   // 每连接一线程
 *          └─ new ProtocolServer(in, out, providerContext).run()
 * </pre>
 * 与 {@code JavaDebugServer}（JDTLS 进程内）的唯一差别：本 host 是独立 JVM，
 * 不依赖 Eclipse/JDT/OSGi —— provider 全部用最小 shim 实现（见
 * {@link JvmManagerProvider} / {@link SimpleSourceLookUpProvider} /
 * {@link NoopProviders}），attach 模式（DAP attach → SocketAttachingConnector）
 * 连已运行测试 JVM 的 jdwp 端口，无 classPaths 校验（launch 模式必需，首期不做）。
 *
 * <p>stdout 契约：启动时打印一行
 * {@code neeko-java-host server listening at: 127.0.0.1:<port>} —— 与
 * {@code src-tauri/src/dap/transport.rs} 的 {@code parse_listen_addr_line}
 * （{@code " server listening at: "}）对齐，Rust 侧据此解析 DAP 监听端口。
 *
 * <p>编译/打包：见 {@code build.sh}（需 JDK ≥11，core 编译目标 Java 11）。开发机本机
 * 有 Homebrew openjdk@21（/opt/homebrew/opt/openjdk@21/bin），可直接
 * {@code bash build.sh} 本地编译 → 产物 {@code ~/.neeko/java-host/neeko-java-host.jar}，
 * Rust 侧 JavaAdapter 运行时按该路径探测；编译验证纳入 {@code build.sh} 幂等流程。
 */
public final class JavaDebugHost {

    private JavaDebugHost() {
        // static-only
    }

    public static void main(String[] args) throws Exception {
        suppressTelemetryNoise();
        try (ServerSocket server = new ServerSocket(0)) {
            String host = "127.0.0.1";
            int port = server.getLocalPort();
            System.out.println("neeko-java-host server listening at: " + host + ":" + port);
            System.out.flush();
            while (true) {
                Socket client = server.accept();
                Thread connection = new Thread(
                    () -> serve(client),
                    "neeko-java-host-connection");
                // Daemon：主 accept 循环被 kill（Neeko 会话结束）时随 JVM 退出。
                connection.setDaemon(true);
                connection.start();
            }
        }
    }

    /**
     * 压住上游遥测噪声：目标 JVM 正常退出（无断点单测跑完即退出）时，
     * {@code UsageDataSession.recordEvent} 对已断开 VM 的 {@code event.toString()}
     * 必抛 {@code VMDisconnectedException}，并以 SEVERE 堆栈打到 stderr ——
     * Rust 侧会把宿主 stderr 转发成 DAP output 事件，用户看到的就是三连堆栈。
     * DAP 会话本身不受影响（VMDisconnect → Terminated 事件正常）。
     * 只过滤这两条遥测消息，其余 java-debug 日志原样保留。
     */
    private static void suppressTelemetryNoise() {
        Logger usageData = Logger.getLogger("java-debug-usage-data");
        usageData.setLevel(Level.OFF);
        Logger javaDebug = Logger.getLogger("java-debug");
        javaDebug.setFilter(record -> {
            String msg = record.getMessage();
            return msg == null
                || (!msg.startsWith("Exception on recording event")
                    && !msg.startsWith("Exception on recording user error"));
        });
    }

    /** 单连接：DAP over TCP，读到 EOF（客户端断开）即返回。 */
    private static void serve(Socket client) {
        try (Socket socket = client;
             InputStream in = socket.getInputStream();
             OutputStream out = socket.getOutputStream()) {
            ProtocolServer server = new ProtocolServer(in, out, createProviderContext());
            server.run();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    /** 注册 5 个最小 provider（对齐 {@code JdtProviderContextFactory} 的集合）。
     *  任何 handler 取未注册 provider 都会抛 {@link IllegalArgumentException}，
     *  故 attach/setBreakpoints/configurationDone 用到的 provider 必须全注册。 */
    private static IProviderContext createProviderContext() {
        IProviderContext context = new ProviderContext();
        context.registerProvider(IVirtualMachineManagerProvider.class, new JvmManagerProvider());
        context.registerProvider(ISourceLookUpProvider.class, new SimpleSourceLookUpProvider());
        context.registerProvider(IEvaluationProvider.class, NoopProviders.evaluation());
        context.registerProvider(IHotCodeReplaceProvider.class, NoopProviders.hotCodeReplace());
        context.registerProvider(ICompletionsProvider.class, NoopProviders.completions());
        return context;
    }
}
