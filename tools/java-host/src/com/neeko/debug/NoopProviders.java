package com.neeko.debug;

import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

import com.microsoft.java.debug.core.DebugException;
import com.microsoft.java.debug.core.IEvaluatableBreakpoint;
import com.microsoft.java.debug.core.adapter.ErrorCode;
import com.microsoft.java.debug.core.adapter.HotCodeReplaceEvent;
import com.microsoft.java.debug.core.adapter.ICompletionsProvider;
import com.microsoft.java.debug.core.adapter.IEvaluationProvider;
import com.microsoft.java.debug.core.adapter.IHotCodeReplaceProvider;
import com.microsoft.java.debug.core.protocol.Types.CompletionItem;
import com.sun.jdi.ObjectReference;
import com.sun.jdi.StackFrame;
import com.sun.jdi.ThreadReference;
import com.sun.jdi.Value;

import io.reactivex.Observable;

/**
 * 评估 / 热替换 / 补全三个 provider 的 no-op shim。
 *
 * <p>java-debug 的 {@code AttachRequestHandler} 对这三个 provider 无条件
 * {@code context.getProvider(...)}（未注册即抛 IAE），所以必须注册；但首期
 * 调试流程（attach → setBreakpoints → configurationDone → 线程/栈/变量/步进）
 * 不经过它们，提供 no-op 实现即可让会话跑通。评估/补全/热替换降级为不可用。
 *
 * <p>静态工厂方法（而非公开构造器）避免这三个实现成为公开 API。
 */
final class NoopProviders {

    private NoopProviders() {
        // static-only
    }

    static IEvaluationProvider evaluation() {
        return new IEvaluationProvider() {
            @Override
            public boolean isInEvaluation(ThreadReference thread) {
                return false;
            }

            @Override
            public CompletableFuture<Value> evaluate(
                    String expression, ThreadReference thread, int depth) {
                return unsupported();
            }

            @Override
            public CompletableFuture<Value> evaluate(
                    String expression, ObjectReference thisContext, ThreadReference thread) {
                return unsupported();
            }

            @Override
            public CompletableFuture<Value> evaluateForBreakpoint(
                    IEvaluatableBreakpoint breakpoint, ThreadReference thread) {
                return unsupported();
            }

            @Override
            public CompletableFuture<Value> invokeMethod(
                    ObjectReference thisContext, String methodName, String methodSignature,
                    Value[] args, ThreadReference thread, boolean invokeSuper) {
                return unsupported();
            }

            @Override
            public void clearState(ThreadReference thread) {
                // no-op
            }
        };
    }

    static IHotCodeReplaceProvider hotCodeReplace() {
        return new IHotCodeReplaceProvider() {
            @Override
            public void onClassRedefined(Consumer<List<String>> consumer) {
                // no-op
            }

            @Override
            public CompletableFuture<List<String>> redefineClasses() {
                return CompletableFuture.completedFuture(Collections.emptyList());
            }

            @Override
            public Observable<HotCodeReplaceEvent> getEventHub() {
                return Observable.empty();
            }
        };
    }

    static ICompletionsProvider completions() {
        return new ICompletionsProvider() {
            @Override
            public List<CompletionItem> codeComplete(StackFrame frame, String snippet,
                    int line, int column) {
                return Collections.emptyList();
            }
        };
    }

    private static <T> CompletableFuture<T> unsupported() {
        return CompletableFuture.failedFuture(
                new DebugException(
                        "Evaluation is not supported by the Neeko Java host (no JDT).",
                        ErrorCode.UNKNOWN_FAILURE.getId()));
    }
}
