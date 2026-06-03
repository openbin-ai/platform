package ai.openapk.core.jnibridge.dto;

import java.util.List;

/**
 * One unique native library (by short name, e.g. "crypto" → "libcrypto.so"),
 * with all the ABIs it ships for and all loader call sites that loaded it.
 *
 * @param shortName  loadLibrary-style name (no "lib" prefix, no ".so" suffix)
 * @param libPaths   every project-relative path that matches lib{shortName}.so
 *                   under resources/lib/&lt;abi&gt;/ — usually one per ABI
 * @param archs      ABIs the library ships for, derived from libPaths
 * @param loaders    indices into the top-level loaders[] array — keeps the
 *                   loader info de-duplicated rather than copied per lib
 */
public record LibraryRef(
        String shortName,
        List<String> libPaths,
        List<String> archs,
        List<Integer> loaders
) {}
