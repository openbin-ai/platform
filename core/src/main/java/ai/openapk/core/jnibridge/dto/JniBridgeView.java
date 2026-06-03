package ai.openapk.core.jnibridge.dto;

import java.time.Instant;
import java.util.List;

/**
 * Top-level payload of the Native tab. Built by
 * {@link ai.openapk.core.jnibridge.JniBridgeScanService} and cached as JSON
 * on {@code projects.jni_bridge_jsonb}.
 *
 * @param libraries  every .so under resources/lib, grouped by short name
 * @param loaders    every System.loadLibrary / load / Runtime.loadLibrary call site
 * @param nativeMethods every Java {@code native} method declaration, with
 *                      JNI match data filled in when an analyzed .so exposes
 *                      the expected symbol
 * @param scannedAt  when the scan ran, for the "Last scanned" UI line
 */
public record JniBridgeView(
        List<LibraryRef> libraries,
        List<LoaderCall> loaders,
        List<NativeMethodDecl> nativeMethods,
        Instant scannedAt
) {}
