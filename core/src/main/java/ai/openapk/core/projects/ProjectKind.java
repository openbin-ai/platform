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
    SCRIPT;

    /**
     * Kinds visible on this kind's product surface. The openbin product
     * (BIN) also hosts SCRIPT projects, so its community/social feeds must
     * match both — a SCRIPT report published to the community is otherwise
     * invisible in every feed despite reading "live". Returned as a
     * Postgres text[] literal for {@code = ANY(CAST(:kinds AS text[]))}
     * binding in the native feed queries.
     */
    public String surfaceKindsPgArray() {
        return this == BIN ? "{BIN,SCRIPT}" : "{" + name() + "}";
    }
}
