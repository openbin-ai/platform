package ai.openapk.core.callchain.dto;

/**
 * A pointer to a method declaration in the project. Used as the identity of a
 * node in a call chain — sufficient to render and jump-to-location.
 */
public record MethodRef(
        String className,
        String name,
        String signature,
        String file,
        int line
) {}
