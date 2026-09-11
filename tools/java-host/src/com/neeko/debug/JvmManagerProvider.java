package com.neeko.debug;

import com.microsoft.java.debug.core.adapter.IVirtualMachineManagerProvider;
import com.sun.jdi.Bootstrap;
import com.sun.jdi.VirtualMachineManager;

/**
 * {@link IVirtualMachineManagerProvider} 最小 shim —— 用 JDK 内置 JDI 的
 * {@link Bootstrap#virtualMachineManager()}，几行即可提供
 * {@code SocketAttachingConnector}（attach 模式）与
 * {@code LaunchingConnector}（launch 模式，本 host 首期只走 attach）。
 *
 * <p>对照 JDT 实现 {@code JdtVirtualMachineManagerProvider}：后者在 Eclipse
 * 平台启动时拉取 JDI 的 {@code VirtualMachineManager}；我们无 JDT，直接
 * {@code Bootstrap.virtualMachineManager()} 等价（同进程内唯一）。
 */
public final class JvmManagerProvider implements IVirtualMachineManagerProvider {

    @Override
    public VirtualMachineManager getVirtualMachineManager() {
        return Bootstrap.virtualMachineManager();
    }
}
