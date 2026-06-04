package ai.openapk.core.projects;

/**
 * Single-source-of-truth message shown to users when they try to invoke a
 * cloud-side Ghidra path while {@code openapk.ghidra.worker-disabled=true}.
 * Both the BIN upload gate (in {@link ProjectService#upload}) and the
 * per-{@code .so} native analysis gate (in {@code NativeAnalysisService.kickoff})
 * surface this exact text — keeping them aligned matters because the frontend
 * relies on the message body to render the friendly "download the CLI" card.
 *
 * <p>The cloud Ghidra worker was costing more in AWS compute than the whole
 * rest of the stack combined for a free OSS project. The desktop CLI moves
 * that compute onto the user's own machine, so this isn't a feature cut —
 * it's a re-shape. Flip the property back to false if/when funding lands.
 */
public final class GhidraSunsetMessage {

    public static final String TEXT = """
            Cloud Ghidra decompile is temporarily disabled — AWS compute cost was unsustainable for a free open-source project.

            Use the desktop CLI instead (Linux/macOS/Windows, free, your binary never leaves your machine):
              https://openbin.ai

            If you'd like to sponsor cloud decompile for the community, email: husam@openbin.ai
            """;

    private GhidraSunsetMessage() {}
}
