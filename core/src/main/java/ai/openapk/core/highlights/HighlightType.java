package ai.openapk.core.highlights;

/**
 * What a highlight pins. FUNCTION and FILE anchor to a spot in the project
 * (and require a {@code targetRef}); VISUAL is a standalone annotated
 * screenshot for cross-cutting evidence (graph view, a diagram, a
 * multi-function pattern) with no single anchor.
 */
public enum HighlightType {
    FUNCTION,
    FILE,
    VISUAL
}
