package ai.openapk.core.callchain.dto;

import java.util.List;

/**
 * One node in a call chain. {@code children} is direction-relative — in an
 * upward chain it holds callers-of-this-method; in a downward chain it holds
 * callees-of-this-method. {@code snippet} is the context line(s) where this
 * relationship appears (the call site for callers, or the line where the
 * callee is invoked for callees). {@code narration} is empty until the AI
 * narrate pass attaches a per-step summary.
 *
 * <p>{@code childrenStats} reports what the walker actually saw at this
 * level vs how many it returned (truncation indicator) and how many were
 * filtered as SDK / framework noise. See {@link ChildrenStats}.
 */
public record CallChainNode(
        MethodRef method,
        String snippet,
        String narration,
        List<CallChainNode> children,
        ChildrenStats childrenStats
) {}
