package ai.openapk.core.projects;

/**
 * Discriminator for the product flows the backend serves:
 *
 * <ul>
 *   <li>{@link #APK} — Android APKs decompiled via JADX. The original OpenAPK.AI
 *       experience: source tree, manifest, JNI bridge, Java-symbol-aware AI.</li>
 *   <li>{@link #BIN} — Native executables (ELF / PE / Mach-O) analyzed via the
 *       Ghidra worker. Pseudocode + disassembly views, binary-aware AI.</li>
 *   <li>{@link #SCRIPT} — Uploaded NPM tarballs (and later PyPI / loose scripts)
 *       statically analyzed by the script-worker Lambda for malicious
 *       supply-chain patterns. Findings + deobfuscated bundle, not a
 *       decompile.</li>
 * </ul>
 *
 * Stored as a string column (see V16 migration) so future kinds can be added
 * without an ordinal shift. All historical rows default to APK.
 */
public enum ProjectKind {
    APK,
    BIN,
    SCRIPT
}
