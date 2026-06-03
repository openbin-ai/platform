package ai.openapk.core.callchain.dto;

/**
 * Honest counts for what the call-chain walker actually saw vs what it returned.
 *
 * <p>For upward walks: {@code totalCandidates} is the raw count of viable
 * caller-method matches the symbol index found (one entry per usage site,
 * after filtering out usages with no enclosing method and de-duping by
 * caller method). {@code sdkCandidatesHidden} is how many of those callers
 * sat in SDK / framework packages and were dropped automatically when the
 * walker decided fan-in was too high to show everything (smart-fan-out
 * mode).
 *
 * <p>For downward walks: {@code totalCandidates} is the count of distinct
 * resolvable callees found at this method's call sites (de-duped by name).
 * {@code sdkCandidatesHidden} is currently always 0 there — downward walks
 * already respect the {@code includeSdks} request flag.
 *
 * <p>The frontend renders this as a "N shown of M" hint plus a chip when
 * {@code sdkCandidatesHidden > 0}.
 */
public record ChildrenStats(
        int shown,
        int totalCandidates,
        int sdkCandidatesHidden
) {
    public static final ChildrenStats EMPTY = new ChildrenStats(0, 0, 0);

    public boolean truncated() {
        return shown < totalCandidates;
    }
}
