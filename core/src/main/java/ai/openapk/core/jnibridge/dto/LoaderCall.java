package ai.openapk.core.jnibridge.dto;

/**
 * One System.loadLibrary("foo") / System.load("/path") / Runtime.loadLibrary call site.
 *
 * @param file    project-relative path of the .java file containing the call
 * @param line    1-based line number
 * @param method  one of "loadLibrary" or "load"
 * @param target  the string literal passed in — short name for loadLibrary
 *                ("foo"), absolute path for load ("/data/.../libfoo.so")
 * @param snippet trimmed source line (for the UI hint)
 */
public record LoaderCall(
        String file,
        int line,
        String method,
        String target,
        String snippet
) {}
