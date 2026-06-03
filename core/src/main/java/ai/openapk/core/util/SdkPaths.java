package ai.openapk.core.util;

import java.util.List;

/**
 * Shared classifier for "this path looks like a bundled third-party SDK, not
 * the APK author's code." Used by Crypto and Search to suppress noise from
 * androidx/kotlin/okhttp/etc. by default, with an opt-in include-SDKs override.
 */
public final class SdkPaths {

    private static final List<String> PREFIXES = List.of(
            "android/", "androidx/",
            "kotlin/", "kotlinx/",
            "com/google/", "com/android/",
            "com/facebook/", "com/squareup/", "com/bumptech/",
            "okhttp3/", "okio/", "retrofit2/",
            "org/jetbrains/", "org/apache/", "org/json/",
            "dagger/", "javax/", "jakarta/",
            "io/reactivex/", "rx/"
    );

    private SdkPaths() {}

    public static boolean isSdkPath(String file) {
        String norm = file.replace('\\', '/');
        // JADX lays decompiled Java out at `{srcDir}/sources/{package}/...` —
        // strip the wrapper so prefix matches like `androidx/` actually fire.
        if (norm.startsWith("sources/")) norm = norm.substring("sources/".length());
        for (String p : PREFIXES) if (norm.startsWith(p)) return true;
        return false;
    }
}
