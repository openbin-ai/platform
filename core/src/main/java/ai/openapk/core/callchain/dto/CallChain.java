package ai.openapk.core.callchain.dto;

import java.util.List;

/**
 * A call chain rooted at one method. {@code callers} walks upward through who
 * invokes this method (and their callers, etc); {@code callees} walks downward
 * through what this method invokes. Both lists are bounded by the depth + fanout
 * passed to {@code build}. {@code rootBody} is a short preview of the root method's
 * body so the user has context without opening the file.
 *
 * <p>{@code callersStats} / {@code calleesStats} report what the walker saw
 * at the root level vs what it returned. See {@link ChildrenStats}.
 */
public record CallChain(
        MethodRef root,
        String rootBody,
        String rootNarration,
        List<CallChainNode> callers,
        List<CallChainNode> callees,
        ChildrenStats callersStats,
        ChildrenStats calleesStats
) {}
