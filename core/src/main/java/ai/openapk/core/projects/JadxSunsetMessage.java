package ai.openapk.core.projects;

/**
 * Single-source-of-truth message shown to users when an APK upload arrives
 * without a CLI-decompiled tree while {@code openapk.jadx.worker-disabled=true}.
 * Mirrors {@link GhidraSunsetMessage} — the frontend relies on the message
 * body to render the friendly "download the CLI" card.
 *
 * <p>Same economics as the Ghidra sunset: an always-on 2 vCPU / 6 GB Fargate
 * task for sporadic decompiles was the single biggest line on the AWS bill.
 * The desktop CLI runs the identical jadx-worker container on the user's own
 * machine and uploads the result, so analysis features are unchanged. Flip
 * the property back to false if/when funding lands.
 */
public final class JadxSunsetMessage {

    public static final String TEXT = """
            Cloud APK decompile is temporarily disabled — AWS compute cost was unsustainable for a free open-source project.

            Use the desktop CLI instead (Linux/macOS/Windows, free, decompiles on your own machine):
              https://openbin.ai

            If you'd like to sponsor cloud decompile for the community, email: husam@openbin.ai
            """;

    private JadxSunsetMessage() {}
}
